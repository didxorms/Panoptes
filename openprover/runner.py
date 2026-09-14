"""Networkless OpenProver controller using Panoptes JSON-RPC for models and Lean."""

import json
import re
import sys
import threading
import time
import uuid
from pathlib import Path

PROTOCOL_OUT = sys.stdout
sys.stdout = sys.stderr

from openprover.budget import Budget
from openprover.lean.core import merge_lean_imports, strip_code_fences
from openprover.prover import Prover
from openprover.tui.headless import HeadlessTUI
import openprover.prover as prover_module


class Rpc:
    def __init__(self):
        self._write_lock = threading.Lock()
        self._pending = {}
        self._pending_lock = threading.Lock()
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self):
        for line in sys.stdin:
            try:
                message = json.loads(line)
                request_id = message.get("requestId")
                with self._pending_lock:
                    pending = self._pending.get(request_id)
                if pending:
                    pending["response"] = message
                    pending["event"].set()
            except Exception as error:
                print(f"[rpc] ignored invalid response: {error}", file=sys.stderr, flush=True)

    def emit(self, event, **payload):
        with self._write_lock:
            PROTOCOL_OUT.write(json.dumps({"event": event, **payload}, ensure_ascii=False) + "\n")
            PROTOCOL_OUT.flush()

    def request(self, method, params):
        request_id = str(uuid.uuid4())
        pending = {"event": threading.Event(), "response": None}
        with self._pending_lock:
            self._pending[request_id] = pending
        self.emit("request", requestId=request_id, method=method, params=params)
        pending["event"].wait()
        with self._pending_lock:
            self._pending.pop(request_id, None)
        response = pending["response"] or {}
        if not response.get("ok"):
            raise RuntimeError(response.get("error") or "Panoptes RPC failed")
        return response.get("result") or {}


class RpcClient:
    vllm = True
    mistral = False
    context_length = 128_000
    answer_reserve = 8_192
    max_output_tokens = 8_192

    def __init__(self, rpc, model):
        self.rpc = rpc
        self.model = model
        self.call_count = 0
        self.total_cost = 0.0
        self._interrupted = False
        self._soft_interrupted = False

    def interrupt(self):
        self._interrupted = True

    def clear_interrupt(self):
        self._interrupted = False

    def soft_interrupt(self):
        self._soft_interrupted = True

    def clear_soft_interrupt(self):
        self._soft_interrupted = False

    def call(self, prompt, system_prompt="", json_schema=None, label="", max_tokens=None, **_kwargs):
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})
        return self.chat(messages, tools=None, max_tokens=max_tokens, label=label)

    def chat(self, messages, tools=None, max_tokens=None, label="", **_kwargs):
        if self._interrupted:
            raise RuntimeError("interrupted")
        started = time.monotonic()
        result = self.rpc.request("model.call", {
            "messages": messages,
            "tools": tools or [],
            "maxTokens": min(int(max_tokens or self.max_output_tokens), self.max_output_tokens),
            "label": label,
        })
        self.call_count += 1
        cost = float(result.get("costMicros", 0)) / 1_000_000
        self.total_cost += cost
        usage = result.get("usage") or {}
        raw = {
            "model": result.get("model", self.model),
            "usage": usage,
            "stop_reason": result.get("finishReason", ""),
            "total_cost_usd": cost,
        }
        return {
            "result": result.get("content", ""),
            "thinking": "",
            "cost": cost,
            "duration_ms": int((time.monotonic() - started) * 1000),
            "raw": raw,
            "finish_reason": result.get("finishReason", "stop"),
            "tool_calls": result.get("toolCalls") or [],
        }


def main():
    run_root = Path("/run")
    config = json.loads((run_root / "config.json").read_text())
    session = run_root / "session"
    lean_project = run_root / "lean-project"
    session.mkdir(parents=True, exist_ok=True)
    lean_project.mkdir(parents=True, exist_ok=True)
    rpc = Rpc()
    stores = {}

    def check_final(path, _project_dir, **_kwargs):
        source_path = Path(path)
        method = "lean.final" if source_path.name.startswith("proof-attempt") else "lean.check"
        result = rpc.request(method, {"code": source_path.read_text()})
        ok = result.get("status") == "verified"
        return ok, result.get("diagnostics", ""), "Panoptes isolated Lean verifier"

    def execute_tool(name, args, worker_id, *_unused):
        if name == "lean_search":
            return (
                "Library search is unavailable in this preview. Use known Std declarations and lean_verify.",
                "unavailable",
            )
        if name not in ("lean_verify", "lean_store"):
            return f"Unknown tool: {name}", "error"
        code = strip_code_fences(args.get("code", ""))
        if not code:
            return "No code provided", "error"
        prefix = stores.get(worker_id, "")
        candidate = merge_lean_imports(prefix, code) if prefix else code
        if name == "lean_store":
            banned = (r"\bsorry\b", r"^\s*axiom\b", r"^\s*unsafe\b", r"\bnative_decide\b")
            if any(re.search(pattern, candidate, re.MULTILINE) for pattern in banned):
                return "Store rejected: candidate contains a banned construct.", "error"
        result = rpc.request("lean.check", {"code": candidate})
        if result.get("status") != "verified":
            return result.get("diagnostics", "Lean rejected the candidate."), "error"
        if name == "lean_verify" and "sorry" in result.get("diagnostics", "").lower():
            return result.get("diagnostics"), "partial"
        if name == "lean_store":
            stores[worker_id] = candidate
            return "OK. Verified snippet stored for this worker.", "ok"
        return result.get("diagnostics") or "OK", "ok"

    prover_module.run_lean_check = check_final
    prover_module.execute_worker_tool = execute_tool

    def make_client(_archive_dir):
        return RpcClient(rpc, "Panoptes funding pool")

    theorem = config["description"].strip() + "\n\nFixed Lean target:\n" + config["statement"]
    template = config["template"]
    resumed = (session / "WHITEBOARD.md").exists()
    proof_path = session / "PROOF.lean"
    if not proof_path.exists():
        prover = Prover(
            work_dir=session,
            theorem_text=theorem,
            mode="prove_and_formalize",
            make_llm=make_client,
            make_worker_llm=make_client,
            model_name="Panoptes funding pool",
            budget=Budget("time", int(config.get("timeLimitSeconds", 900)), conclude_after=0.98),
            autonomous=True,
            verbose=False,
            tui=HeadlessTUI(),
            isolation=True,
            max_workers=int(config.get("maxWorkers", 3)),
            lean_project_dir=lean_project,
            lean_theorem_text=template,
            resumed=resumed,
            lean_items=True,
            lean_worker_tools=True,
            on_budget_out="exit",
            on_rate_limited="exit",
            verifier=True,
        )
        prover.run()
    proof = proof_path.read_text() if proof_path.exists() else ""
    discussion_path = session / "DISCUSSION.md"
    whiteboard_path = session / "WHITEBOARD.md"
    rpc.emit(
        "complete",
        proof=proof,
        discussion=discussion_path.read_text()[-12000:] if discussion_path.exists() else "",
        checkpoint=whiteboard_path.read_text()[-3000:] if whiteboard_path.exists() else "",
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        Rpc().emit("fatal", error=str(error)[:3000])
        raise
