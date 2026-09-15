# The AI Output Contract

**Current state.** What the system does with a model's response, and what it promises the client about it.

Extracted from `development-conventions.md` §8.5–§8.5a. The *rule* — **a model's output is untrusted input and gets the same treatment as a request body** — stays in §8 where the other input-validation rules live. The parse-site defaults and the Markdown contract are business logic about this product's AI path, and belong here.

## The four defaults, and why each goes the way it does

Every parse site returns a safe empty rather than raising, defaults toward *less* confidence, and never reaches a `throw`.

| Site | Default | Why that direction |
| :--- | :--- | :--- |
| `_json_object` / `_json_array` | **searches** for JSON, returns `{}` / `[]` | Models wrap JSON in prose and fences regardless of instructions. Searching is the correct posture; parsing the whole response is not |
| `_confidence` | **0**, not 1 | A UI that hides low-confidence output must hide the *unreadable* ones. Defaulting to 1 promotes exactly the malformed responses |
| `classify` → `department_id` | validated against the **candidate set** | The one whose failure is a routing error rather than an exception: an invented id files a ticket into a department that does not exist |
| `parse_review` | unrecognizable verdict → **COMPLETE** | Counter-intuitive and right: an unparseable review means the *reviewer* failed, not that the draft is bad. Treating it as PARTIAL turns one flaky model into a doubled bill |

**The ledger clause is the one most likely to be missed.** A generation that produced unusable output still cost money and is still ledgered. A parse failure that skips the ledger row is a metering hole in the shape of a bug fix — the spend already happened. `tests/test_hostile_output_e2e.py` fires ten hostile responses at every generation RPC and asserts all three properties, including that one.

Truncation deserves its own note: `finish_reason == MAX_TOKENS` produces symptoms identical to a badly-answered question, and the fix is a one-line constant change. `gemini.py` logs it at WARN for exactly that reason — the class of bug where the diagnosis is impossible and the fix is trivial is the one worth instrumenting.

## The answer is Markdown, and that is a contract with two client-side halves

The generation prompt states an output format. Markdown came out of it before it was ever asked for, because the training data is full of it — a property of the **model**, not of the system, and one a version bump or a `FAST → QUALITY` tier change can withdraw silently. `eval/run.py` scores `renders_as_markdown` so that withdrawal shows up as a number rather than as a support ticket.

Two consequences do **not** belong in the backend, and writing them down is the only way they get honoured.

**Render with HTML disabled — markdown-to-text, never markdown-to-raw-HTML.** The answer is generated from tenant-uploaded documents, so a document containing `<img src=x onerror=…>` reaches the renderer through the answer. The backend forwards the model's output **verbatim** and is tested for it: escaping server-side would corrupt every legitimate `<` in a code sample while still leaving the renderer free to interpret HTML — protection that costs correctness and buys nothing. One layer decides, and it is the one that knows whether it is producing text or markup.

**The client must render progressively and tolerate unterminated constructs.** Tier 1 chat streams token by token, so mid-stream the client holds an opened code fence with no closing one, or half a bullet list. That is not a backend bug to fix; it is a rendering requirement. A renderer that re-parses strictly on every chunk makes the answer visibly flicker between "raw text" and "formatted" on every token.

The backend's own half of the contract is tested: concatenated tokens reproduce `completion.content` byte for byte, so a lost fence cannot be introduced between the stream and the stored message.

## See also

- [development-conventions.md §8.5](../development-conventions.md) — the rule this page implements
- `apps/rag-service/eval/run.py` — the eval harness that scores `renders_as_markdown`
- `apps/rag-service/tests/test_hostile_output_e2e.py` — the ten hostile responses
