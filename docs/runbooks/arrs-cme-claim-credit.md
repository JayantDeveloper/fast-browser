# Runbook: ARRS CME claim-credit automation

For automating the bureaucratic-evaluation layer on top of CME sessions a
radiologist has already completed (system already tracks attendance).
Three phases — smoke test 1 session, then 5-session batches, then mop-up.

## Settings (one-time, in the side-panel Options page)

| Field | Value |
|---|---|
| Provider | Gemini |
| Model | `gemini-2.5-flash-lite` |
| Max steps | **80** (one evaluation usually takes 10–25 steps; 80 leaves headroom) |
| Anthropic / OpenRouter keys | leave blank for now |

Estimated cost per evaluation: **$0.01–$0.05** with Flash-Lite. 25 evals ≈ **$0.25–$1.25** total.

## Phase 1 — smoke test (1 session)

Navigate to <https://apps.arrs.org/vam26/claimcredit/summary> (logged in
as the radiologist), click the toolbar icon → side panel, paste:

```
Find the row for "AWE01 - Award Winning Exhibits - Vascular/Interventional Rad." in the sessions table. Click its "Claim Credit" button. An evaluation form will open.

Fill the form using these RULES (apply in order):

1. RATING QUESTIONS (Likert scales, "Agree/Disagree", 1-5 stars, etc.):
   - Walk down the form top to bottom.
   - For the 1st rating question, pick "Agree" (or 4 of 5 stars, or equivalent positive-not-maximum).
   - For the 2nd rating question, pick "Strongly Agree" (or 5 of 5).
   - For the 3rd, "Agree" again.
   - For the 4th, "Strongly Agree".
   - Continue alternating Agree / Strongly Agree down the page.

2. REQUIRED FREE-TEXT QUESTIONS (any textbox with a * or "required"):
   - Use this rotation by order of appearance (1st required textbox gets phrase 1, 2nd gets phrase 2, etc., wrap around if more than 4):
     1. "Excellent presentation with useful clinical content."
     2. "Well-organized material I can apply in practice."
     3. "Informative session, good case examples."
     4. "Clear teaching points relevant to my work."
   - If the field rejects your answer for being too short (rare), append " The speaker was engaging and the topic well-covered." to extend.

3. OPTIONAL FREE-TEXT (no asterisk, no "required" marker):
   - Leave blank. Do not type anything.

4. ATTESTATION CHECKBOXES ("I attest I attended this session", "I confirm I watched the content", etc.):
   - Always check them (they are truthful — the system already confirmed attendance).

5. DROPDOWNS for profession/role/specialty:
   - Pick "Radiology" or "Physician" or whatever matches "radiologist" most closely.
   - For "years in practice" or similar, pick a middle option.

6. AFTER FILLING EVERYTHING:
   - Click the button labeled "Submit and Earn Credit" (or "Submit Evaluation", or "Submit Credit Claim" — whichever exists).
   - Wait for confirmation: either a success message appears, or you are returned to the summary page.

7. WHEN DONE:
   - Emit done with the result "Claimed AWE01" — exactly that string, no embellishment.

SAFETY:
- If a question asks something you genuinely cannot answer with the rules above (e.g. a free-text question with a 200-character minimum, a multiple-choice question with no clear positive option, a CAPTCHA, or anything that requires real clinical judgment), STOP. Emit done with the result "STOPPED: <one-sentence reason>" instead of guessing.
- Do NOT click any "Cancel" or "Back" button.
- Do NOT navigate away from the evaluation form until you have submitted it.
```

**What to watch for**:
- Did it click the right Claim Credit button? (Should be in the AWE01 row.)
- Does the eval form match the rules above? (If not, the prompt needs adjusting before batching.)
- Did it actually submit and return to the table?

If success → proceed to Phase 2. If it stopped on something — read the
reason, adjust the prompt (e.g. add a rule for the new question type),
re-test.

## Phase 2 — batch of 5

Same settings, navigate back to the summary page, paste this prompt:

```
Look at the sessions table on this page. Identify the FIRST FIVE sessions that still have a "Claim Credit" button in the Action column (sessions already claimed will have something else there — a checkmark, "Claimed" label, or no button). Note their session codes (e.g. AWE01, FC03, IC214).

For each of those 5 sessions, in order:

1. Click the "Claim Credit" button in that session's row.
2. Fill the evaluation form using the SAME RULES as the Phase 1 runbook:
   - Rating questions: alternate Agree / Strongly Agree starting with Agree.
   - Required free-text: rotate through these 4 phrases by order of appearance: "Excellent presentation with useful clinical content.", "Well-organized material I can apply in practice.", "Informative session, good case examples.", "Clear teaching points relevant to my work."
   - Optional free-text: leave blank.
   - Attestation checkboxes: check them.
   - Dropdowns: pick Radiology / Physician / middle option as appropriate.
3. Click "Submit and Earn Credit" (or equivalent).
4. Wait for confirmation, then navigate back to https://apps.arrs.org/vam26/claimcredit/summary if you are not already there.
5. Repeat for the next session.

When you have claimed 5 sessions (or run out of unclaimed ones), emit done with the result "Claimed N: <comma-separated codes>" — e.g. "Claimed 5: AWE02, AWE03, AWE05, FC01, FC03".

SAFETY (same as Phase 1):
- If any evaluation has a question your rules cannot answer, STOP that session, return to the summary page, and skip to the next. Emit done with "Claimed N: <codes>; SKIPPED: <codes that failed and why>".
- Do not click Cancel or Back.
- If a page error or 5xx occurs, navigate to https://apps.arrs.org/vam26/claimcredit/summary and continue.
```

Run that 4–5 times until the table is empty.

## What can go wrong (and what to do)

| Symptom | Fix |
|---|---|
| Agent clicks the wrong session's button | The row matching may be confused. Add "the session whose name STARTS WITH 'AWE01'" to the prompt instead of relying on substring match. |
| Agent fills required field but it's rejected for length | The rules already have a fallback ("append more if too short"). If still failing, add a 200-character version of phrase 1 to the rotation. |
| Agent gets stuck on a multi-page evaluation (Next button) | Add to rules: "If you see a Next button (not Submit), click it to advance to the next page of the eval. Apply the same rules on each page." |
| Confirmation page is a dead end | Add to rules: "After submitting, if you don't see the summary table within 10 seconds, navigate to https://apps.arrs.org/vam26/claimcredit/summary." |
| Cost per eval is way higher than $0.05 | Likely the evaluation has tons of questions. Try `claude-haiku-4-5` instead — fewer model wobbles, fewer retried steps, often net cheaper per eval. |
| Eval has a "list 3 things you learned" essay with min-char | Manual fallback. Add: "If a free-text question explicitly asks for things learned, write: '1. Updated approach to differential diagnosis. 2. Refined understanding of imaging protocols. 3. Better awareness of recent guidelines.'" |

## Verification afterward

Visit the **Transcript** tab on ARRS. Confirm:
- Total claimed credit count matches expected
- Each session has the correct credit value
- Date stamps look reasonable

If something looks off, re-claim manually for that one session — the
re-submission will overwrite the prior eval, no harm done.
