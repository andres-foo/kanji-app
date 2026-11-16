(() => {
  const button = document.getElementById("ai-test");
  const result = document.getElementById("ai-test-result");
  if (!button || !result) return;

  const messages = {
    disabled: "No API key is configured. Add one above and save.",
    unauthorized: "API key was rejected — check Settings",
    "rate-limited": "Rate limited — try again shortly",
    timeout: "The AI request timed out",
    offline: "The AI provider is unreachable — check the connection and base URL",
    "bad-response": "The AI provider returned an unexpected response — check the base URL and model",
    forbidden: "Request rejected. Reload the page and try again.",
  };

  const show = (text, ok) => {
    result.textContent = text;
    result.classList.toggle("ok", ok);
    result.classList.toggle("err", !ok);
  };

  button.addEventListener("click", async () => {
    button.disabled = true;
    show("Testing…", true);
    try {
      const response = await fetch("/api/ai/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.ok === true) show("Connection works.", true);
      else show(messages[data.error] ?? "AI request failed.", false);
    } catch {
      show(messages.offline, false);
    } finally {
      button.disabled = false;
    }
  });
})();
