from __future__ import annotations

import json
import unittest
from typing import Any

from ktem.agent_runtime import DynamicPlanner, planner_tool_schemas


def response_with_tool(
    name: str,
    arguments: dict[str, Any],
    call_id: str = "call-1",
) -> dict:
    return {
        "choices": [
            {
                "message": {
                    "content": "",
                    "tool_calls": [
                        {
                            "id": call_id,
                            "function": {
                                "name": name,
                                "arguments": json.dumps(arguments),
                            },
                        }
                    ],
                }
            }
        ]
    }


def response_without_tool(content: str) -> dict:
    return {"choices": [{"message": {"content": content}}]}


def run_planner(planner: DynamicPlanner, executor):
    stream = planner.run(
        [{"role": "user", "content": "test"}],
        planner_tool_schemas(),
        executor,
    )
    events = []
    while True:
        try:
            events.append(next(stream))
        except StopIteration as stop:
            return events, stop.value


def test_planner_executes_multiple_dynamic_tool_steps():
    responses = [
        response_with_tool("inspect_knowledge_base", {"refresh": True}),
        response_with_tool(
            "retrieve_evidence",
            {"query": "Transformer attention", "purpose": "ground evidence"},
            "call-2",
        ),
        response_without_tool("Evidence is ready for final RAG synthesis."),
    ]
    calls = []

    def completion(*_):
        return responses.pop(0)

    def executor(name, arguments):
        calls.append((name, arguments))
        return {"tool": name, "ok": True}

    planner = DynamicPlanner(completion_fn=completion, max_steps=3)
    events, result = run_planner(planner, executor)

    assert [name for name, _ in calls] == [
        "inspect_knowledge_base",
        "retrieve_evidence",
    ]
    assert result.iterations == 3
    assert result.replan_count == 0
    assert len(result.observations) == 2
    assert result.stop_reason == "planner_finished"
    assert any(event["phase"] == "observe" for event in events)


def test_tool_failure_is_returned_to_model_for_replan():
    responses = [
        response_with_tool("retrieve_evidence", {"query": "missing"}),
        response_without_tool("Fallback evidence is sufficient."),
    ]
    seen_tool_error = False

    def completion(_model, messages, _tools, _tokens):
        nonlocal seen_tool_error
        seen_tool_error = seen_tool_error or any(
            message.get("role") == "tool"
            and '"ok": false' in message.get("content", "")
            for message in messages
        )
        return responses.pop(0)

    def executor(_name, _arguments):
        raise RuntimeError("retrieval backend unavailable")

    planner = DynamicPlanner(completion_fn=completion, max_steps=3)
    events, result = run_planner(planner, executor)

    assert seen_tool_error
    assert result.replan_count == 1
    assert result.observations[0].error.startswith("RuntimeError:")
    assert any(
        event.get("phase") == "replan" and event.get("status") == "running"
        for event in events
    )


def test_duplicate_tool_call_is_blocked_and_replanned():
    responses = [
        response_with_tool("inspect_knowledge_base", {"refresh": False}),
        response_with_tool(
            "inspect_knowledge_base",
            {"refresh": False},
            "call-2",
        ),
        response_without_tool("Use the first observation."),
    ]
    executions = 0

    def completion(*_):
        return responses.pop(0)

    def executor(_name, _arguments):
        nonlocal executions
        executions += 1
        return {"documents": 3}

    planner = DynamicPlanner(completion_fn=completion, max_steps=3)
    _, result = run_planner(planner, executor)

    assert executions == 1
    assert result.replan_count == 1
    assert "Duplicate tool call blocked" in result.observations[1].error


def test_tool_budget_completion_is_not_misreported_as_replan():
    responses = [
        response_with_tool("retrieve_evidence", {"query": "first"}),
        response_with_tool(
            "retrieve_evidence",
            {"query": "second"},
            "call-2",
        ),
    ]

    def completion(*_):
        return responses.pop(0)

    def executor(_name, arguments):
        return {"query": arguments["query"]}

    planner = DynamicPlanner(completion_fn=completion, max_steps=2)
    events, result = run_planner(planner, executor)

    assert result.replan_count == 0
    assert result.stop_reason == "tool_budget_reached"
    assert any(
        event.get("phase") == "complete" and event.get("status") == "info"
        for event in events
    )


class DynamicPlannerTests(unittest.TestCase):
    test_dynamic_steps = staticmethod(test_planner_executes_multiple_dynamic_tool_steps)
    test_replan = staticmethod(test_tool_failure_is_returned_to_model_for_replan)
    test_duplicate_guard = staticmethod(
        test_duplicate_tool_call_is_blocked_and_replanned
    )
    test_budget_completion = staticmethod(
        test_tool_budget_completion_is_not_misreported_as_replan
    )


if __name__ == "__main__":
    unittest.main()
