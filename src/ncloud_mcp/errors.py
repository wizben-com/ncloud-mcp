"""Errors safe to return across the MCP boundary."""


class SafeError(Exception):
    """A fixed, sanitized operational error with no upstream input or body."""
