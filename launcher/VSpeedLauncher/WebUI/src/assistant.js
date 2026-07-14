/* ============================================================
   Kelvin — AI Assistant
   Diagnoses mod/crash/launch problems and proposes 1-click fixes.
   Renders assistant replies as Markdown (inline code, bold, lists,
   fenced code blocks, blockquotes, headers, horizontal rules).
   ============================================================ */
const { useState: aiS, useEffect: aiE, useRef: aiR } = React;
const { useApp: useAppAI } = window.CryoStore;

// ── Markdown renderer ─────────────────────────────────────────────────────
// Converts a Markdown string to an HTML string safe for dangerouslySetInnerHTML.
// Only used for AI-generated content, never raw user input.
function markdownToHtml(raw) {
  if (!raw) return "";
  const slots = [];
  const stash = html => { const i = slots.length; slots.push(html); return `\x00${i}\x00`; };

  let s = raw;

  // 1. Fenced code blocks — stash BEFORE any escaping so content is preserved verbatim.
  //    Safe regex: [^`] prevents catastrophic backtracking on unclosed fences.
  s = s.replace(/```(\w*)\n?((?:[^`]|`(?!``))*?)```/g, (_, lang, code) => {
    const esc = code.trim()
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const lb = lang ? `<span class="md-lang">${lang}</span>` : "";
    return stash(`<pre class="md-pre">${lb}<code>${esc}</code></pre>`);
  });

  // 2. Escape remaining HTML (prevents XSS from AI output)
  s = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // 3. Headers H1-H3
  s = s.replace(/^### (.+)$/gm, (_, t) => stash(`<h3 class="md-h" style="font-size:1.0em">${t}</h3>`));
  s = s.replace(/^## (.+)$/gm,  (_, t) => stash(`<h2 class="md-h" style="font-size:1.15em">${t}</h2>`));
  s = s.replace(/^# (.+)$/gm,   (_, t) => stash(`<h1 class="md-h" style="font-size:1.3em">${t}</h1>`));

  // 4. Horizontal rule
  s = s.replace(/^[-*_]{3,}\s*$/gm, () => stash(`<hr class="md-hr">`));

  // 5. Inline code — stash before bold/italic so backticks aren't processed further
  s = s.replace(/`([^`\n]+)`/g, (_, c) => stash(`<code class="md-ic">${c}</code>`));

  // 6. Bold + italic (*** then ** then *)
  s = s.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  s = s.replace(/\*\*(.+?)\*\*/g,     "<strong>$1</strong>");
  s = s.replace(/\*(.+?)\*/g,          "<em>$1</em>");

  // 7. Blockquotes (after escaping, ">" became "&gt;")
  s = s.replace(/^&gt; (.+)$/gm, (_, t) => stash(`<blockquote class="md-bq">${t}</blockquote>`));

  // 8. Unordered lists — group consecutive bullet lines
  s = s.replace(/((?:^[-*+] [^\n]+\n?)+)/gm, m => {
    const items = m.trim().split("\n")
      .map(l => `<li>${l.replace(/^[-*+] /, "")}</li>`).join("");
    return stash(`<ul class="md-ul">${items}</ul>`);
  });

  // 9. Ordered lists
  s = s.replace(/((?:^\d+\. [^\n]+\n?)+)/gm, m => {
    const items = m.trim().split("\n")
      .map(l => `<li>${l.replace(/^\d+\. /, "")}</li>`).join("");
    return stash(`<ol class="md-ol">${items}</ol>`);
  });

  // 10. Paragraphs — split on blank lines; don't wrap pure stash tokens in <p>
  const blocks = s.split(/\n\n+/);
  s = blocks.map(b => {
    b = b.trim();
    if (!b) return "";
    if (/^\x00\d+\x00$/.test(b)) return b;  // already a block element
    return `<p class="md-p">${b.replace(/\n/g, "<br>")}</p>`;
  }).filter(Boolean).join("\n");

  // 11. Restore all stashed elements
  s = s.replace(/\x00(\d+)\x00/g, (_, i) => slots[+i]);

  return s;
}

// Pull @@ACTION {json} lines out of an assistant message → { text, actions }
function parseAssistant(raw) {
  const actions = [];
  const lines = [];
  // Reasoning models (Nemotron / R1 / QwQ) may wrap chain-of-thought in <think>…</think>.
  // Hide it: drop completed blocks, and while still streaming hide an unclosed one.
  const cleaned = String(raw || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*$/i, "");
  cleaned.split(/\r?\n/).forEach(line => {
    const m = line.match(/^\s*@@ACTION\s+(\{.*\})\s*$/);
    if (m) {
      try { const a = JSON.parse(m[1]); if (a && a.type) { actions.push(a); return; } } catch (e) {}
    }
    if (/^\s*@@ACTION\b/.test(line)) return;   // hide partial/incomplete action lines while streaming
    lines.push(line);
  });
  return { text: lines.join("\n").trim(), actions };
}

const ACTION_ICON = { disableMod: "package", enableMod: "package", rebuildCache: "database", setRam: "cpu", openCrashReport: "alert", openModsFolder: "folder", webSearch: "search", findMod: "download", openUrl: "globe" };

// Only let the assistant open links on well-known modding domains — its input
// includes log text, so an injected URL must never be openable blindly.
const AI_URL_ALLOW = ["curseforge.com", "modrinth.com", "minecraft.wiki", "fabricmc.net", "neoforged.net", "docs.neoforged.net", "files.minecraftforge.net", "github.com", "githubusercontent.com", "google.com", "prismlauncher.org"];
function aiUrlAllowed(url) {
  try { const h = new URL(url).hostname.toLowerCase(); return /^https:$/i.test(new URL(url).protocol) && AI_URL_ALLOW.some(d => h === d || h.endsWith("." + d)); }
  catch { return false; }
}

function ActionChip({ action, status, onApply }) {
  const done = status === "ok";
  const failed = status === "err";
  const running = status === "running";
  return React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: "var(--r-md)", background: "var(--acc-soft)", border: "1px solid var(--acc-soft-2)", marginTop: 8 } },
    React.createElement(Icon, { name: ACTION_ICON[action.type] || "zap", size: 15, style: { color: "var(--acc-text)" } }),
    React.createElement("span", { style: { flex: 1, fontSize: 12.5, fontWeight: 600, color: "var(--text)" } }, action.label || action.type),
    done
      ? React.createElement("span", { style: { display: "flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 700, color: "var(--success)" } }, React.createElement(Icon, { name: "check", size: 14 }), "Applied")
      : React.createElement(Btn, { variant: failed ? "outline" : "primary", size: "sm", disabled: running, iconSpin: running, icon: running ? "refresh" : null, onClick: onApply }, failed ? "Retry" : "Apply"),
  );
}

function ThinkingDots() {
  return React.createElement("span", { style: { display: "inline-flex", gap: 3, alignItems: "center", marginLeft: 3 } },
    [0, 1, 2].map(i => React.createElement("span", { key: i, style: { width: 5, height: 5, borderRadius: "50%", background: "var(--acc-2)", display: "inline-block", animation: "blink 1.2s " + (i * 0.2) + "s ease-in-out infinite" } })));
}

// Shown while the assistant is working but hasn't produced a visible answer yet.
// For reasoning models (Nemotron etc.) it streams the live chain-of-thought so the
// user can SEE it's doing something instead of staring at a frozen blank bubble.
function ThinkingView({ think }) {
  const tail = think ? String(think).replace(/\s+/g, " ").trim() : "";
  return React.createElement("div", null,
    React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "var(--text-dim)" } },
      React.createElement(Icon, { name: "loader", size: 13, spin: true, style: { color: "var(--acc-2)" } }),
      React.createElement("span", null, "Thinking"),
      !tail && React.createElement(ThinkingDots, null)),
    tail && React.createElement("div", { style: { marginTop: 7, fontSize: 11.5, fontStyle: "italic", color: "var(--text-faint)", lineHeight: 1.5, maxHeight: 64, overflow: "hidden", whiteSpace: "pre-wrap" } }, "…" + tail.slice(-280)));
}

function MsgRow({ msg, msgIdx, applied, onApply }) {
  if (msg.role === "user")
    return React.createElement("div", { style: { display: "flex", justifyContent: "flex-end", marginBottom: 14 } },
      React.createElement("div", { style: { maxWidth: "78%", padding: "10px 14px", borderRadius: "14px 14px 4px 14px", background: "var(--acc-grad)", color: "#fff", fontSize: 13.5, lineHeight: 1.5, whiteSpace: "pre-wrap", boxShadow: "0 4px 16px var(--acc-glow)" } }, msg.content));

  if (msg.error)
    return React.createElement("div", { style: { display: "flex", gap: 10, marginBottom: 14 } },
      React.createElement("div", { style: { width: 30, height: 30, flexShrink: 0, borderRadius: 9, display: "grid", placeItems: "center", background: "var(--danger-soft, rgba(255,80,80,.12))", color: "var(--danger, #ff6b6b)" } }, React.createElement(Icon, { name: "alert", size: 16 })),
      React.createElement("div", { style: { maxWidth: "82%", padding: "10px 14px", borderRadius: "4px 14px 14px 14px", background: "var(--panel-2)", border: "1px solid var(--danger, #ff6b6b)", color: "var(--text-dim)", fontSize: 13, lineHeight: 1.5 } }, msg.error));

  const { text, actions } = parseAssistant(msg.content);
  // During streaming: plain text (fast, no regex).
  // After done: render Markdown (one-time, full pass).
  // This prevents catastrophic backtracking on unclosed code-fences mid-stream.
  const html = msg.streaming ? null : markdownToHtml(text);
  return React.createElement("div", { style: { display: "flex", gap: 10, marginBottom: 14 } },
    React.createElement("div", { style: { width: 30, height: 30, flexShrink: 0, borderRadius: 9, display: "grid", placeItems: "center", background: "var(--acc-soft)", border: "1px solid var(--acc-soft-2)", color: "var(--acc-text)" } }, React.createElement(Icon, { name: "sparkles", size: 16 })),
    React.createElement("div", { style: { maxWidth: "82%" } },
      (text || msg.streaming) && React.createElement("div", {
        style: { padding: "12px 16px", borderRadius: "4px 14px 14px 14px", background: "var(--panel-2)", border: "1px solid var(--border)" },
      },
        msg.streaming
          ? (text
              ? React.createElement("div", { className: "md-body", style: { whiteSpace: "pre-wrap", lineHeight: 1.65 } },
                  text,
                  React.createElement("span", { className: "md-cursor", style: { fontSize: 13, marginLeft: 2 } }, "▍"))
              : React.createElement(ThinkingView, { think: msg.think }))   // no answer yet → show it's working
          : React.createElement("div", { className: "md-body", dangerouslySetInnerHTML: { __html: html || "" } }),
      ),
      actions.map((a, i) => React.createElement(ActionChip, { key: i, action: a, status: applied[msgIdx + ":" + i], onApply: () => onApply(a, msgIdx + ":" + i) })),
    ));
}

function AssistantScreen() {
  const { api, hasBridge, navigate } = useAppAI();
  const [insts, setInsts] = aiS([]);
  const [instId, setInstId] = aiS(null);
  const [attach, setAttach] = aiS({ logs: true, crash: true, mods: false, launcher: false });
  const [messages, setMessages] = aiS([]);
  const [input, setInput] = aiS("");
  const [busy, setBusy] = aiS(false);
  const [hasKey, setHasKey] = aiS(true);
  const [model, setModel] = aiS("phi-4-mini-instruct");
  const [applied, setApplied] = aiS({});
  const [memory, setMemory] = aiS([]);
  const [showMem, setShowMem] = aiS(false);
  const scrollRef = aiR(null);
  const streamRef = aiR(null);

  // Streaming: assemble chunk events into the current assistant message.
  aiE(() => {
    function onChunk(e) {
      const d = e.detail || {}; if (d.streamId !== streamRef.current) return;
      setMessages(m => { const c = m.slice(); for (let i = c.length - 1; i >= 0; i--) { if (c[i].streaming) {
        if (d.reasoning) c[i] = { ...c[i], think: (c[i].think || "") + (d.delta || "") };   // live chain-of-thought
        else c[i] = { ...c[i], content: (c[i].content || "") + (d.delta || "") };
        break; } } return c; });
    }
    function onDone(e) {
      const d = e.detail || {}; if (d.streamId !== streamRef.current) return;
      streamRef.current = null; setBusy(false);
      // If the model only produced reasoning (no content), promote it to the answer.
      setMessages(m => m.map(x => x.streaming ? { ...x, streaming: false, content: x.content || x.think || "(empty reply)", think: "" } : x));
    }
    function onErr(e) {
      const d = e.detail || {}; if (d.streamId !== streamRef.current) return;
      streamRef.current = null; setBusy(false);
      setMessages(m => { const c = m.slice(); for (let i = c.length - 1; i >= 0; i--) { if (c[i].streaming) { c[i] = { role: "assistant", error: d.error || "Stream error" }; break; } } return c; });
    }
    window.addEventListener("cryo:aiChunk", onChunk);
    window.addEventListener("cryo:aiDone", onDone);
    window.addEventListener("cryo:aiError", onErr);
    return () => { window.removeEventListener("cryo:aiChunk", onChunk); window.removeEventListener("cryo:aiDone", onDone); window.removeEventListener("cryo:aiError", onErr); };
  }, []);

  aiE(() => {
    if (!hasBridge) return;
    api.getInstances().then(l => { setInsts(l || []); if ((l || []).length) setInstId(x => x || l[0].id); }).catch(() => {});
    api.getConfig().then(c => { if (c) { setHasKey(!!c.aiHasKey); if (c.aiModel) setModel(String(c.aiModel).replace(/^.*\//, "")); } }).catch(() => {});
  }, [hasBridge]);

  // Load memory when instance changes
  aiE(() => {
    if (!hasBridge || !instId || !api.getAiMemory) return;
    api.getAiMemory(instId).then(r => setMemory((r && r.entries) || [])).catch(() => {});
  }, [hasBridge, instId]);

  aiE(() => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; }, [messages, busy]);

  // Preload hook: Logs "Ask AI" and crash auto-diagnose set window.__cryoAssistantPreload then navigate here.
  aiE(() => {
    const pre = window.__cryoAssistantPreload;
    if (!pre) return;
    window.__cryoAssistantPreload = null;
    if (pre.instanceId) setInstId(pre.instanceId);
    if (pre.attach) setAttach(a => ({ ...a, ...pre.attach }));
    if (pre.prompt) {
      if (pre.autoSend) send(pre.prompt, { instanceId: pre.instanceId, attach: { ...attach, ...(pre.attach || {}) } });
      else setInput(pre.prompt);
    }
  }, []);

  async function send(text, opts) {
    const content = (text != null ? text : input).trim();
    if (!content || busy) return;
    setInput("");
    const next = [...messages, { role: "user", content }];
    setMessages([...next, { role: "assistant", content: "", streaming: true }]);
    setBusy(true);
    const at = (opts && opts.attach) || attach;
    const streamId = "s" + Date.now() + Math.random().toString(36).slice(2, 7);
    streamRef.current = streamId;
    const payload = {
      messages: next.filter(m => !m.error).map(m => ({ role: m.role, content: m.content })),
      instanceId: (opts && opts.instanceId) || instId || undefined,
      attach: Object.keys(at).filter(k => at[k]),
      streamId,
    };
    const r = await api.aiChatStream(payload).catch(e => ({ ok: false, error: String(e) }));
    if (!r || r.ok === false) {
      streamRef.current = null; setBusy(false);
      setMessages(m => { const c = m.slice(); for (let i = c.length - 1; i >= 0; i--) { if (c[i].streaming) { c[i] = { role: "assistant", error: (r && r.error) || "Request failed" }; break; } } return c; });
    }
  }

  async function applyAction(action, key) {
    if (!instId) { window.toast({ tone: "warn", icon: "info", title: "Pick an instance", body: "Choose the instance this fix applies to (top right)." }); return; }
    setApplied(a => ({ ...a, [key]: "running" }));
    try {
      const args = action.args || {};
      switch (action.type) {
        case "disableMod":      await api.setModEnabled(instId, args.file, false); break;
        case "enableMod":       await api.setModEnabled(instId, args.file, true); break;
        case "rebuildCache":    await api.rebuildCache(instId); break;
        case "setRam":          await api.saveInstanceCfg(instId, { ramMax: Math.round(Number(args.gb) * 1024) }); break;
        case "openCrashReport": await api.openCrashReport(instId); break;
        case "openModsFolder":  await api.openFolder(instId); break;
        case "webSearch": {
          const query = String(args.query || "").trim();
          if (!query) throw new Error("Empty search query");
          await api.openUrl("https://www.google.com/search?q=" + encodeURIComponent(query));
          break;
        }
        case "findMod": {
          const query = String(args.query || "").trim();
          if (!query) throw new Error("Empty mod query");
          window.__cryoModSearch = query;
          navigate("browse");
          break;
        }
        case "openUrl": {
          const url = String(args.url || "").trim();
          if (!aiUrlAllowed(url)) throw new Error("Blocked untrusted link");
          await api.openUrl(url);
          break;
        }
        default: throw new Error("Unknown action: " + action.type);
      }
      setApplied(a => ({ ...a, [key]: "ok" }));
      window.toast({ tone: "success", icon: "check", title: "Applied", body: action.label || action.type });
      // Save to AI memory — only for real fixes (not search/open navigations).
      if (["disableMod", "enableMod", "rebuildCache", "setRam"].includes(action.type) && instId && api.saveAiMemory) {
        const userMsgs = messages.filter(m => m.role === "user");
        const problem = userMsgs.length > 0 ? userMsgs[userMsgs.length - 1].content : "";
        api.saveAiMemory(instId, problem.slice(0, 300), action.label || action.type, [action]).catch(() => {});
        // Refresh memory list
        api.getAiMemory(instId).then(r => setMemory((r && r.entries) || [])).catch(() => {});
      }
    } catch (e) {
      setApplied(a => ({ ...a, [key]: "err" }));
      window.toast({ tone: "danger", icon: "alert", title: "Couldn't apply", body: String((e && e.message) || e) });
    }
  }

  function onKey(e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }

  const attachPill = (k, label) => React.createElement("button", {
    className: "no-drag", onClick: () => setAttach(a => ({ ...a, [k]: !a[k] })),
    style: { fontSize: 11.5, fontWeight: 600, padding: "5px 11px", borderRadius: 999, cursor: "pointer",
      border: "1px solid " + (attach[k] ? "var(--acc-soft-2)" : "var(--border)"),
      background: attach[k] ? "var(--acc-soft)" : "var(--panel-2)",
      color: attach[k] ? "var(--acc-text)" : "var(--text-dim)" } }, label);

  const suggestions = [
    ["Why did my game crash?", { logs: true, crash: true, mods: false }],
    ["Find mod conflicts", { logs: true, crash: false, mods: true }],
    ["How can I reduce lag?", { logs: true, crash: false, mods: false }],
    ["How do I speed up my launch?", { logs: false, crash: false, mods: false }],
  ];

  // ── Preview mode (no bridge) ──
  if (!hasBridge)
    return React.createElement("div", { style: { padding: 40, display: "grid", placeItems: "center", height: "100%" } },
      React.createElement(Card, { style: { maxWidth: 440, textAlign: "center" } },
        React.createElement(Icon, { name: "sparkles", size: 30, style: { color: "var(--acc-2)" } }),
        React.createElement("h3", { style: { margin: "12px 0 6px" } }, "Assistant runs in the desktop launcher"),
        React.createElement("p", { style: { fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5 } }, "Open Kelvin as the installed app to chat with the AI and apply fixes.")));

  return React.createElement("div", { style: { height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" } },
    // header
    React.createElement("div", { style: { padding: "20px 28px 14px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" } },
      React.createElement("div", { style: { width: 40, height: 40, borderRadius: 12, display: "grid", placeItems: "center", background: "var(--acc-soft)", border: "1px solid var(--acc-soft-2)", color: "var(--acc-text)" } }, React.createElement(Icon, { name: "sparkles", size: 21 })),
      React.createElement("div", null,
        React.createElement("h2", { style: { margin: 0, fontSize: 18, fontWeight: 720 } }, "Assistant"),
        React.createElement("div", { style: { fontSize: 11.5, color: "var(--text-faint)", marginTop: 1 } }, "NVIDIA · " + model)),
      React.createElement("div", { style: { marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 } },
        insts.length > 0 && React.createElement(Select, { value: instId, width: 200, size: "sm",
          options: insts.map(i => ({ value: i.id, label: i.name || i.id })), onChange: setInstId }),
        memory.length > 0 && React.createElement(Tip, { label: "AI Memory — " + memory.length + " past fix" + (memory.length !== 1 ? "es" : ""), side: "bottom" },
          React.createElement(Btn, { variant: showMem ? "accentSoft" : "ghost", size: "sm", icon: "database",
            onClick: () => setShowMem(m => !m) }, memory.length)),
        messages.length > 0 && React.createElement(Btn, { variant: "ghost", size: "sm", icon: "trash", onClick: () => { setMessages([]); setApplied({}); } }, "Clear")),
    ),
    // context attach row
    React.createElement("div", { style: { padding: "0 28px 12px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } },
      React.createElement("span", { style: { fontSize: 11.5, color: "var(--text-faint)", fontWeight: 600 } }, "Attach context:"),
      attachPill("logs", "latest.log"), attachPill("crash", "crash report"), attachPill("mods", "mod list"), attachPill("launcher", "launcher log"),
      React.createElement("span", { style: { fontSize: 11, color: "var(--text-faint)" } }, "— sent with your next message so the AI can diagnose")),

    // Memory panel (collapsible)
    showMem && memory.length > 0 && React.createElement("div", { style: { margin: "0 28px 12px", padding: "12px 16px", borderRadius: "var(--r-md)", background: "var(--panel-2)", border: "1px solid var(--border)" } },
      React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 10 } },
        React.createElement(Icon, { name: "database", size: 14, style: { color: "var(--acc-2)" } }),
        React.createElement("span", { style: { fontSize: 12.5, fontWeight: 700, flex: 1 } }, "AI Memory"),
        React.createElement(Btn, { variant: "ghost", size: "sm", icon: "trash",
          onClick: async () => {
            if (!window.confirm("Clear all memory for this instance?")) return;
            await api.clearAiMemory(instId).catch(() => {});
            setMemory([]);
          } }, "Clear all")),
      React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 6 } },
        memory.map((e, i) => React.createElement("div", { key: i, style: { padding: "8px 10px", borderRadius: "var(--r-sm)", background: "var(--panel)", border: "1px solid var(--border-faint)", fontSize: 12 } },
          React.createElement("div", { style: { fontWeight: 600, color: "var(--text)", marginBottom: 2 } }, e.problem || "(no problem recorded)"),
          React.createElement("div", { style: { color: "var(--success)", fontSize: 11.5 } }, "Fix: " + (e.solution || "—")),
        ))),
    ),

    // no-key banner
    !hasKey && React.createElement("div", { style: { margin: "0 28px 12px", padding: "12px 16px", borderRadius: "var(--r-md)", background: "var(--panel-2)", border: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 12 } },
      React.createElement(Icon, { name: "info", size: 17, style: { color: "var(--acc-2)" } }),
      React.createElement("span", { style: { flex: 1, fontSize: 12.5, color: "var(--text-dim)" } }, "No NVIDIA API key yet. Paste your build.nvidia.com key to start chatting."),
      React.createElement(Btn, { variant: "primary", size: "sm", icon: "settings", onClick: () => navigate("settings") }, "Add key")),

    // messages
    React.createElement("div", { ref: scrollRef, style: { flex: 1, overflowY: "auto", padding: "8px 28px 8px", minHeight: 0 } },
      React.createElement("div", { style: { maxWidth: 760, margin: "0 auto" } },
        messages.length === 0
          ? React.createElement("div", { style: { padding: "30px 0", textAlign: "center" } },
              React.createElement("div", { style: { fontSize: 14, color: "var(--text-dim)", marginBottom: 4 } }, "Ask about crashes, mod conflicts, lag, or launch speed."),
              React.createElement("div", { style: { fontSize: 12, color: "var(--text-faint)", marginBottom: 18 } }, "I can read this instance's logs/crash/mods and propose 1-click fixes."),
              React.createElement("div", { style: { display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" } },
                suggestions.map(([q, at], i) => React.createElement(Btn, { key: i, variant: "outline", size: "sm",
                  onClick: () => { setAttach(a => ({ ...a, ...at })); send(q); } }, q))))
          : messages.map((m, i) => React.createElement(MsgRow, { key: i, msg: m, msgIdx: i, applied, onApply: applyAction })),
        busy && !messages.some(m => m.streaming) && React.createElement("div", { style: { display: "flex", gap: 10, marginBottom: 14 } },
          React.createElement("div", { style: { width: 30, height: 30, borderRadius: 9, display: "grid", placeItems: "center", background: "var(--acc-soft)", color: "var(--acc-text)" } }, React.createElement(Icon, { name: "sparkles", size: 16 })),
          React.createElement("div", { style: { padding: "11px 16px", borderRadius: "4px 14px 14px 14px", background: "var(--panel-2)", border: "1px solid var(--border)", color: "var(--text-faint)", fontSize: 13, display: "flex", alignItems: "center", gap: 6 } },
            React.createElement("span", null, "Thinking"),
            React.createElement("span", { style: { display: "flex", gap: 3, alignItems: "center" } },
              ...[0,1,2].map(i => React.createElement("span", { key: i, style: { width: 5, height: 5, borderRadius: "50%", background: "var(--acc-2)", display: "inline-block", animation: `blink 1.2s ${i * 0.2}s ease-in-out infinite` } })))
          )))),

    // composer
    React.createElement("div", { style: { padding: "12px 28px 20px" } },
      React.createElement("div", { style: { maxWidth: 760, margin: "0 auto", display: "flex", gap: 10, alignItems: "flex-end", background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: "var(--r-lg)", padding: 8 } },
        React.createElement("textarea", {
          className: "no-drag", value: input, onChange: e => setInput(e.target.value), onKeyDown: onKey,
          placeholder: hasKey ? "Ask Kelvin… (Enter to send, Shift+Enter for newline)" : "Add your API key in Settings first…",
          rows: 1, disabled: busy,
          style: { flex: 1, resize: "none", maxHeight: 140, minHeight: 24, background: "transparent", border: "none", outline: "none", color: "var(--text)", fontSize: 13.5, lineHeight: 1.5, fontFamily: "inherit", padding: "6px 6px" } }),
        React.createElement(Btn, { variant: "primary", icon: busy ? "refresh" : "play", iconSpin: busy, disabled: busy || !input.trim(), onClick: () => send() }, "Send")),
      React.createElement("div", { style: { maxWidth: 760, margin: "6px auto 0", fontSize: 10.5, color: "var(--text-faint)", textAlign: "center" } },
        "AI can make mistakes — review proposed fixes before applying. Attached logs/mods are sent to NVIDIA when using the hosted API.")),
  );
}

window.CryoAssistant = { AssistantScreen };
