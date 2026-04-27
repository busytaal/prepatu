from typing import Callable, Dict, Any, Awaitable, Optional

ActionHandler = Callable[[Dict[str, Any], Any], Awaitable[Any]]

class ToolRegistry:
    """
    A generic registry for mapping VFDL tool calls and UI events to domain-specific business logic.
    This allows the voice engine to remain completely ignorant of IELTS, Onboarding, or other app logic.
    """
    def __init__(self):
        self._handlers: Dict[str, ActionHandler] = {}

    def on_tool_call(self, tool_name: str):
        """
        Decorator to register a handler for a specific LLM tool call.
        
        Example:
            @registry.on_tool_call("save_target_score")
            async def save_score(args: dict, session_context: any):
                db.save(args["score"])
                return {"status": "success"}
        """
        def decorator(func: ActionHandler) -> ActionHandler:
            self._handlers[tool_name] = func
            return func
        return decorator

    def get_handler(self, tool_name: str) -> Optional[ActionHandler]:
        """Retrieve the registered handler for a tool call, if it exists."""
        return self._handlers.get(tool_name)

# A global, singleton registry that your FastAPI app can initialize and pass to the Engine.
action_registry = ToolRegistry()
