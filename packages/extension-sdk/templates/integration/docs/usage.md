# **TITLE**

`__NAMESPACE__.get(path)` sends a GET request to the server set in Settings → Extensions → **TITLE** and returns the parsed JSON, or text when the server does not answer JSON.

- `path` starts with `/` and is appended to the server URL: `__NAMESPACE__.get("/items")`.
- A failed request throws with `e.code` `SERVER_ERROR` and the server's status in the message.
