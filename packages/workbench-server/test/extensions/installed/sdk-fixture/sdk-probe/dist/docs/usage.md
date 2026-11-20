# **TITLE**

`sdkProbe.get(path)` sends a GET request to the server set in Settings → Extensions → **TITLE** and returns the parsed JSON, or text when the server does not answer JSON.

- `path` starts with `/` and is appended to the server URL: `sdkProbe.get("/items")`.
- A failed request throws with `e.code` `SERVER_ERROR` and the server's status in the message.
