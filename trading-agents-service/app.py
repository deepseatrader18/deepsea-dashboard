import logging
import os
import threading
import time
import traceback
import uuid
from datetime import datetime, timezone

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

from tradingagents.graph.trading_graph import TradingAgentsGraph

logger = logging.getLogger("trading-agents-service")
logging.basicConfig(level=logging.INFO)
from tradingagents.default_config import DEFAULT_CONFIG

app = FastAPI(title="DeepSea TradingAgents Service")

# Shared secret checked against the Node dashboard's proxy calls. Unset in
# local/dev runs (no header check); set on Render so the service isn't
# reachable by anyone who finds the URL.
SERVICE_TOKEN = os.environ.get("TRADING_AGENTS_SERVICE_TOKEN", "")

# Mirrors cli/main.py's MessageBuffer bookkeeping: the same agent names, the
# same chunk keys, the same "report content + finalizing agent completed"
# rule for progress, so the dashboard shows real pipeline state rather than
# an invented timeline.
ANALYST_MAPPING = {
    "market": "Market Analyst",
    "social": "Sentiment Analyst",
    "news": "News Analyst",
    "fundamentals": "Fundamentals Analyst",
}
ANALYST_REPORT_MAP = {
    "market": "market_report",
    "social": "sentiment_report",
    "news": "news_report",
    "fundamentals": "fundamentals_report",
}
ANALYST_ORDER = ["market", "social", "news", "fundamentals"]
RESEARCH_TEAM = ["Bull Researcher", "Bear Researcher", "Research Manager"]
RISK_TEAM = ["Aggressive Analyst", "Neutral Analyst", "Conservative Analyst"]
AGENT_ORDER = (
    [ANALYST_MAPPING[k] for k in ANALYST_ORDER]
    + RESEARCH_TEAM
    + ["Trader"]
    + RISK_TEAM
    + ["Portfolio Manager"]
)

# Cheap/fast Gemini models by default — this runs on Render's free tier, so
# keep it to 1 debate/risk round (roughly TradingAgents' "Shallow" depth)
# instead of the CLI's "Deep" default, which can run 10+ minutes even on a
# fast model.
_config = DEFAULT_CONFIG.copy()
_config["llm_provider"] = "google"
_config["deep_think_llm"] = os.environ.get("TRADING_AGENTS_DEEP_MODEL", "gemini-3.5-flash")
_config["quick_think_llm"] = os.environ.get("TRADING_AGENTS_QUICK_MODEL", "gemini-3.5-flash-lite")
_config["max_debate_rounds"] = int(os.environ.get("TRADING_AGENTS_MAX_DEBATE_ROUNDS", "1"))
_config["max_risk_discuss_rounds"] = int(os.environ.get("TRADING_AGENTS_MAX_RISK_ROUNDS", "1"))

_graph = None
_graph_lock = threading.Lock()


def get_graph() -> TradingAgentsGraph:
    """Build the graph once and reuse it — compiling it is expensive and it
    carries no per-run state (ticker/date are passed into propagate/stream
    each call), so one instance safely serves every request."""
    global _graph
    if _graph is None:
        with _graph_lock:
            if _graph is None:
                _graph = TradingAgentsGraph(
                    selected_analysts=ANALYST_ORDER,
                    debug=True,
                    config=_config,
                )
    return _graph


_jobs: dict[str, dict] = {}
_jobs_lock = threading.Lock()
# Render's free tier has one weak CPU — running two analyses at once would
# starve both. One at a time keeps each run's latency predictable.
_run_lock = threading.Lock()


class AnalyzeRequest(BaseModel):
    symbol: str
    date: str | None = None
    asset_type: str = "stock"


def _check_token(x_service_token: str | None):
    if SERVICE_TOKEN and x_service_token != SERVICE_TOKEN:
        raise HTTPException(status_code=401, detail="unauthorized")


def _new_job(symbol: str, date: str, asset_type: str) -> dict:
    job_id = uuid.uuid4().hex[:12]
    job = {
        "id": job_id,
        "symbol": symbol,
        "date": date,
        "asset_type": asset_type,
        "status": "queued",  # queued | running | completed | failed
        "agent_status": {name: "pending" for name in AGENT_ORDER},
        "reports": {},
        "final_decision": None,
        "error": None,
        "started_at": None,
        "finished_at": None,
    }
    with _jobs_lock:
        _jobs[job_id] = job
    return job


def _apply_chunk(job: dict, chunk: dict) -> None:
    agent_status = job["agent_status"]
    reports = job["reports"]

    found_active = False
    for key in ANALYST_ORDER:
        agent_name = ANALYST_MAPPING[key]
        report_key = ANALYST_REPORT_MAP[key]
        if chunk.get(report_key):
            reports[report_key] = chunk[report_key]
        has_report = bool(reports.get(report_key))
        if has_report:
            agent_status[agent_name] = "completed"
        elif not found_active:
            agent_status[agent_name] = "in_progress"
            found_active = True

    if chunk.get("investment_debate_state"):
        debate = chunk["investment_debate_state"]
        bull = (debate.get("bull_history") or "").strip()
        bear = (debate.get("bear_history") or "").strip()
        judge = (debate.get("judge_decision") or "").strip()
        if bull or bear:
            for name in RESEARCH_TEAM:
                if agent_status[name] != "completed":
                    agent_status[name] = "in_progress"
        parts = []
        if bull:
            parts.append(f"### Bull Researcher\n{bull}")
        if bear:
            parts.append(f"### Bear Researcher\n{bear}")
        if judge:
            parts.append(f"### Research Manager Decision\n{judge}")
        if parts:
            reports["investment_plan"] = "\n\n".join(parts)
        if judge:
            for name in RESEARCH_TEAM:
                agent_status[name] = "completed"
            agent_status["Trader"] = "in_progress"

    if chunk.get("trader_investment_plan"):
        reports["trader_investment_plan"] = chunk["trader_investment_plan"]
        if agent_status["Trader"] != "completed":
            agent_status["Trader"] = "completed"
            for name in RISK_TEAM:
                agent_status[name] = "in_progress"

    if chunk.get("risk_debate_state"):
        risk = chunk["risk_debate_state"]
        agg = (risk.get("aggressive_history") or "").strip()
        con = (risk.get("conservative_history") or "").strip()
        neu = (risk.get("neutral_history") or "").strip()
        judge = (risk.get("judge_decision") or "").strip()
        parts = []
        if agg:
            parts.append(f"### Aggressive Analyst\n{agg}")
        if con:
            parts.append(f"### Conservative Analyst\n{con}")
        if neu:
            parts.append(f"### Neutral Analyst\n{neu}")
        if judge:
            parts.append(f"### Portfolio Manager Decision\n{judge}")
        if parts:
            reports["final_trade_decision"] = "\n\n".join(parts)
        if judge and agent_status["Portfolio Manager"] != "completed":
            for name in RISK_TEAM + ["Portfolio Manager"]:
                agent_status[name] = "completed"


def _run_job(job_id: str) -> None:
    job = _jobs[job_id]
    with _run_lock:
        job["status"] = "running"
        job["started_at"] = time.time()
        try:
            graph = get_graph()
            symbol, date, asset_type = job["symbol"], job["date"], job["asset_type"]

            instrument_context = graph.resolve_instrument_context(symbol, asset_type)
            init_state = graph.propagator.create_initial_state(
                symbol, date, asset_type=asset_type, instrument_context=instrument_context,
            )
            args = graph.propagator.get_graph_args()

            job["agent_status"][ANALYST_MAPPING[ANALYST_ORDER[0]]] = "in_progress"

            trace = []
            for chunk in graph.graph.stream(init_state, **args):
                _apply_chunk(job, chunk)
                trace.append(chunk)

            for name in job["agent_status"]:
                job["agent_status"][name] = "completed"

            final_state: dict = {}
            for chunk in trace:
                final_state.update(chunk)

            job["final_decision"] = final_state.get("final_trade_decision")
            job["status"] = "completed"
        except Exception as exc:  # noqa: BLE001 - surface any failure to the caller
            job["status"] = "failed"
            job["error"] = str(exc)
            logger.error("Job %s failed: %s\n%s", job_id, exc, traceback.format_exc())
        finally:
            job["finished_at"] = time.time()


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/analyze")
def start_analyze(req: AnalyzeRequest, x_service_token: str | None = Header(default=None)):
    _check_token(x_service_token)
    if _run_lock.locked():
        raise HTTPException(status_code=409, detail="An analysis is already running — wait for it to finish")

    date = req.date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    job = _new_job(req.symbol.upper(), date, req.asset_type)
    threading.Thread(target=_run_job, args=(job["id"],), daemon=True).start()
    return {"job_id": job["id"]}


@app.get("/analyze/{job_id}")
def get_analyze(job_id: str, x_service_token: str | None = Header(default=None)):
    _check_token(x_service_token)
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")

    elapsed = None
    if job["started_at"]:
        end = job["finished_at"] or time.time()
        elapsed = round(end - job["started_at"], 1)

    return {**job, "elapsed_seconds": elapsed}
