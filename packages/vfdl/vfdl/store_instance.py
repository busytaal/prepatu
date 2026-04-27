"""
Global store instance to prevent circular imports.
"""
from vfdl.store.sqlite import SqliteSessionStore

store = SqliteSessionStore()
