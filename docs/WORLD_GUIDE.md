# World Guide: implementation plan

Status: planned; not implemented or enabled. This document defines the agreed
feature and acceptance criteria, not working setup instructions.

World Guide is an optional voice companion that explains the current world,
discusses its stories, and navigates to landmarks through natural language.
The public installation will show an informational control without enabling
paid conversations. Operators can enable conversations locally or in their own
authenticated deployment using their own credentials.

## Product behavior

- “Take me to the story about Arctic ice” resolves meaning against the current
  edition's titles, summaries, and landmark descriptions, not just exact words.
- “What is this object?” uses the selected story and explains its artistic
  representation separately from the reported facts.
- “What did the researchers find?” can retrieve the permitted source on demand.
- “How does that relate to the other climate story?” can compare stories with
  citations and distinguish evidence from the guide's interpretation.
- When a reference is ambiguous, ask a short clarifying question. When no story
  matches, say so rather than choosing an unrelated hotspot.

Use ElevenLabs Agents for conversational audio and tool calling. Start with
its managed conversation model; retain a small provider boundary so another
voice service or a custom conversation model can replace it later. Research
uses our existing paid Gemini adapter initially, with the existing source-data
policy. Research credentials are separate from ElevenLabs credentials.

No change to daily world generation, publication, video generation, or X posting
is required. A guide failure must never stop ordinary exploration.

## Architecture and data boundary

```text
Published world JSON → compact session context → ElevenLabs voice conversation
                                                ↕
Browser microphone / speaker / waveform ← authenticated session credential
                                                ↕
Navigation tool → validated story ID → existing viewer selection and camera
Research tool → optional project backend → source policy → permitted article
                                            ↓
                              in-memory analysis with paid Gemini
                                            ↓
                              original answer + citation links → guide
```

The world context includes edition ID, date, story IDs, titles, original
summaries, source links, landmark explanations, and the selected story. The
browser already has positions and bounds in the publication manifest. The agent
chooses a story ID; it does not need to generate camera coordinates or receive
the SPZ, image bytes, or the entire JSON Schema on every turn.

| Data | Intended handling |
| --- | --- |
| Microphone audio, conversation text, compact world context | Processed by ElevenLabs and its configured conversation services |
| Raw article text | Retrieved and analyzed in backend memory; sent only to the configured research model, never uploaded to an ElevenLabs knowledge base |
| Research answers and citations | Returned to the guide; may therefore enter provider conversation context |
| Project-side audio recordings and transcripts | Not persisted; optional visible transcript exists only for the active session |
| Article cache | At most bounded, session-only memory; clear on session end/expiry; no S3, database, browser storage, or persistent model cache |
| Operational metrics | Content-free counts, latency, error codes, and usage; no audio, article bodies, prompts, tool payloads, credentials, or signed session URLs |

Ephemeral means the project does not intentionally persist those payloads; it
does not mean providers cannot process them or that memory is securely erased.
Source inclusion is not blanket permission: reuse the current policy checks
for the exact page and intended use. Historical pages may have changed or become
unavailable. Keep edition-time facts distinct from newly retrieved information.

## Phase 1 — Contracts and credential-free foundation

- [ ] Add small typed world-context, navigation-tool, research-result, and
  conversation-state contracts. Validate all tool arguments and results.
- [ ] Build compact context from the existing publication manifest. Do not add
  duplicate story storage, embeddings, or a vector database for 1–10 stories.
- [ ] Define `navigateToStory(editionId, storyId, openPanel)` and
  `researchStory(editionId, storyIds, question)`; include citation URLs and
  retrieval time in research results. No arbitrary URL-fetch tool.
- [ ] Add a mock voice/research adapter and fixture conversations so development
  and automated tests need no microphone, credentials, or paid requests.
- [ ] Keep context current when selection changes. End/reset the session when
  the edition changes; reject delayed calls belonging to the old edition.

Acceptance: fixtures cover exact references, paraphrases, ambiguous references,
missing stories, and stale calls. The credential-free demo still runs normally.

## Phase 2 — Optional session backend and privacy configuration

- [ ] Add a small local backend in `pipeline/` for session authorization and
  research; keep the frontend a static export. Cloud hosting is a later opt-in
  adapter, not a prerequisite for a local demonstration.
- [ ] Document proposed server-only `ELEVENLABS_API_KEY` and
  `ELEVENLABS_AGENT_ID` settings when implemented. Check required research
  credentials separately; basic navigation can work without research enabled.
- [ ] Require agent authentication. Exchange the server key for a short-lived
  signed URL or WebRTC token; never ship the API key in frontend configuration,
  localStorage, publication JSON, or a public key-entry form.
- [ ] Protect local endpoints with loopback binding, strict origin validation,
  and session authorization; localhost alone is not authorization. A hosted
  backend requires operator authentication, not just CORS/domain allowlisting.
- [ ] Add bounded session duration, idle disconnect, concurrent-session and
  research-call limits. Enforce limits in the backend/provider configuration,
  not solely in a browser timer. Fail closed when credentials are absent.
- [ ] Provide a reproducible agent configuration with narrowly defined client
  tools, research tools, model, voice, and privacy settings. Validate tool names
  match the SDK implementation. Do not automatically provision a paid agent.
- [ ] Disable audio saving, configure the shortest supported transcript
  retention (zero days where supported), and require the operator to opt out
  of training/data use before live testing. Report which settings can be
  verified through the API and which require dashboard confirmation.
- [ ] Do not enable post-call transcript webhooks, content-bearing tracing, or
  persistent knowledge-base uploads. Enterprise Zero Retention Mode is optional
  if available; it is not a requirement or a claim for ordinary accounts.

Acceptance: missing configuration cannot create a paid session; unauthenticated
requests are rejected; keys and payloads stay out of browser bundles and logs.
An operator can inspect actual privacy settings before making a paid call.

## Phase 3 — Voice interaction and semantic navigation

- [ ] Integrate the ElevenLabs React SDK behind the voice adapter; audit its
  installed dependency licenses and update notices before adding it.
- [ ] Start audio only after an explicit user action and microphone permission.
  Handle denied permission, unavailable devices, reconnects, interruption, and
  end-session cleanup without affecting the viewer.
- [ ] Resolve natural-language references using the current story context.
  Require clarification for plausible multiple matches; do not treat a model's
  self-reported confidence as proof of a correct match.
- [ ] Route valid tool calls through `selectStory` in
  `frontend/components/world-experience.tsx`. “Take me to…” uses the existing
  camera movement, focus, and story panel behavior; a focus-only action can
  reuse the existing `openPanel: false` path.
- [ ] Acknowledge navigation only after the application accepts the action.
  Avoid duplicate animations from retries and reject invented IDs/coordinates.
- [ ] Explain that landmarks are artistic interpretations. Never claim to see
  live scene details beyond the supplied metadata.

Acceptance: a live local conversation can navigate by paraphrase, discuss a
selected story, ask for clarification, and survive an interrupted response.
Reduced-motion behavior and manual camera controls remain usable.

## Phase 4 — On-demand research and comparisons

- [ ] Fetch nothing at startup beyond the world context. Research only in
  response to a question requiring more detail than published summaries.
- [ ] Resolve source URLs from trusted edition metadata on the server; recheck
  current access/reuse permissions, redirects, public-network destinations,
  content type, size, timeout, and per-source rate limits.
- [ ] Reuse ephemeral extraction and the paid Gemini research adapter. Return
  bounded original explanations with citations, not full pages or long quotes.
- [ ] Treat retrieved text as untrusted evidence, never instructions. It cannot
  authorize navigation, change tool policy, or request credentials.
- [ ] Support bounded comparisons across the current edition's stories. Mark
  unsupported connections as interpretation and explain unavailable evidence.
- [ ] Say “Let me check the source” while researching; show researching status
  and allow cancellation. Cancel or discard obsolete results on session end,
  edition change, or superseding questions.
- [ ] Add broader lookup through a replaceable search adapter only after the
  linked-source path works. Restrict retrieval to currently permitted sources;
  search results alone do not establish reuse permission. Document any extra
  provider, credential, retention boundary, and cost before enabling search.

Acceptance: source failure falls back honestly to the published summary;
answers carry usable citations; hostile pages and arbitrary/internal URLs are
rejected; body text is absent from storage and logs after a session.

## Phase 5 — Responsive World Guide interface

- [ ] Add a compact floating control positioned around existing arrows,
  thumbstick, sound, fullscreen, and panels. Test desktop, portrait, landscape,
  and embedded viewing rather than hard-coding a competing corner position.
- [ ] Show disabled, ready, connecting, listening, researching, speaking, and
  error states. Public disabled mode offers setup documentation, not a key form.
- [ ] Use cyan input waves and violet output waves, with text/icon cues so color
  is not the only signal. Add microphone mute, end session, and an expandable
  session transcript with source links.
- [ ] Lower ambient music during conversation and restore the prior volume
  and mute preference afterward. Guide audio and ambient mute remain explicit.
- [ ] Lazy-load the SDK only for enabled installations. Animate the small
  waveform independently from React's scene tree using SDK audio measurements;
  stop its loop when inactive and respect reduced motion.
- [ ] Keep overlays keyboard accessible with clear focus, touch targets, and
  status announcements. No automatic microphone activation or background call.

Acceptance: disabled mode makes no ElevenLabs requests; the guide does not
block scene controls or cause React/3D updates on every waveform frame.

## Phase 6 — Verification, documentation, and release

- [ ] Unit-test context filtering, tool validation, authorization, source
  restrictions, result freshness, cleanup, and limits with mock providers.
- [ ] Browser-test disabled public mode, permission denial, navigation, stale
  callbacks, panel layout, disconnect, music restoration, and reduced motion.
- [ ] Test semantic behavior with curated paraphrases and ambiguity cases in an
  explicitly authorized live session; mocked tools alone do not establish LLM
  reliability. Record aggregate outcomes without storing conversation content.
- [ ] Measure research latency, voice responsiveness, viewer frame-time impact,
  and actual provider usage. Add session-cost guidance to `COSTS.md`, separately
  from daily generation costs; do not advertise unmeasured cost estimates.
- [ ] Turn this plan into a concise setup/architecture guide once implemented.
  Update `.env.example`, quick start links, data boundary, service licensing,
  and third-party notices. Mark any incomplete capabilities accurately.
- [ ] Run relevant package license checks, typechecks, tests, builds, the root
  secret scanner, and diff checks. Verify a clean-clone credential-free demo.
- [ ] Demonstrate locally with the operator's credentials first. Publish only
  the disabled informational UI to the public installation unless authenticated
  paid access is separately approved. Leave all daily automation unchanged.

## Provider references and claims

Verify current account capabilities and terms during implementation:

- [ElevenLabs React SDK](https://elevenlabs.io/docs/eleven-agents/libraries/react):
  client tools, contextual updates, and audio measurements.
- [Agent authentication](https://elevenlabs.io/docs/eleven-agents/customization/authentication):
  temporary authenticated connections without exposing server keys.
- [Privacy settings](https://elevenlabs.io/docs/eleven-agents/customization/privacy):
  audio saving and conversation retention controls.
- [Training/data-use opt-out](https://elevenlabs.io/docs/help-center/legal/is-my-data-used-to-improve-eleven-labs-ai-models):
  operator account settings, separate from retention controls.
- [Zero Retention Mode and downstream LLM policy](https://elevenlabs.io/docs/eleven-api/resources/zero-retention-mode):
  enterprise eligibility and ElevenLabs' stated prohibition on third-party LLM
  providers training on customer content. This does not imply no processing,
  no retention everywhere, or automatic opt-out of ElevenLabs' own data use.

Suggested public language once implemented: “World Guide is optional and uses
your configured voice and research services. We minimize shared context,
process source articles temporarily, and document training and retention
settings. Provider processing and retention depend on your account and terms.”
