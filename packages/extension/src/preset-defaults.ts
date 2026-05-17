/**
 * Pre-baked task presets that ship with the extension. Users see them in
 * the sidepanel dropdown without having to copy-paste a prompt.
 *
 * Keep prompts in their own files under docs/runbooks/ for review and
 * inline them here so the extension is self-contained.
 */

import type { TaskPreset } from './messages.js';

const ARRS_BATCH_TASK = `Look at the sessions table on this page. You will iterate through it from top to bottom, claiming credit for every row that still has a "Claim Credit" button in its Action column. Rows that are already claimed will show something other than that button (a checkmark, "Claimed" text, or nothing) — skip those.

Each evaluation form uses the same template. For every evaluation, fill the form using these RULES. Multiple sub-questions share the same option text, so every radio and checkbox carries a "[question stem] option" prefix to disambiguate.

EVALUATION RULES (apply to every form):

1. Question "Participation in this activity will:" — 4 radio sub-questions:
   - "[Improve my current knowledge] To a Great Degree"
   - "[Improve my competence] To a Great Degree"
   - "[Improve my performance] Somewhat"
   - "[Improve my patients' outcomes] To a Great Degree"

2. Question "Action I will take..." — checkbox: pick ONLY the one whose label contains "validated my current practice. I will not make any changes".

3. Question "objective, scientifically rigorous and free of commercial bias" — single radio: pick "Completely".

4. Question "Barriers to implementing..." — checkbox: pick ONLY "No Barriers".

5. Question "Please indicate your comfort level..." — 2 radio sub-questions:
   - The first sub-question ("can discuss" or "can identify" or similar): pick "I am very comfortable."
   - The second sub-question ("can describe" or "can recognize" or similar): pick "I am very comfortable."

6. If a form has different sub-question text but the SAME option scales, apply the same logic: pick the maximum positive option for the first sub-question, alternate to mid-positive on the third, max again for the fourth, etc. Always pick "I am very comfortable" for comfort questions.

7. For any required free-text textbox you encounter, rotate through these (1st gets phrase 1, 2nd phrase 2, etc., wrap around):
   - "Excellent presentation with useful clinical content."
   - "Well-organized material I can apply in practice."
   - "Informative session, good case examples."
   - "Clear teaching points relevant to my work."

8. Leave optional (non-required) free-text blank.

9. Check any attestation checkbox ("I attest I attended", "I confirm I watched", etc.).

10. For dropdowns: profession → "Radiology" or "Physician"; years in practice → middle option.

WORKFLOW PER SESSION:
- Click the "Claim Credit" button for the next unclaimed session.
- Apply all the rules above to fill the form.
- Verify NO "Please select your answer" warnings remain in the visible text. If any do, find which sub-question is unanswered and click the appropriate radio FIRST.
- Click "Submit and Earn Credit" (or equivalent Submit button).
- Wait for confirmation. If you are not back on the summary page (URL contains "ClaimCredit/Summary") within 5 seconds, navigate explicitly: goto https://apps.arrs.org/VAM26/ClaimCredit/Summary
- Look at the table again; find the NEXT row with a "Claim Credit" button; repeat.

DONE CONDITION:
- When the table has no more "Claim Credit" buttons, OR when you have successfully claimed at least 25 sessions, emit done with the result formatted as: "Claimed N sessions: <comma-separated session codes>" — e.g. "Claimed 5 sessions: AWE01, AWE02, AWE03, AWE05, FC01".

HARD STOPS:
- If you scroll 4 times in a row without clicking anything, navigate to https://apps.arrs.org/VAM26/ClaimCredit/Summary and continue with the next session.
- If a form has options that don't match any rule (a question type you've never seen), navigate back to summary and skip that session. Note it in your done message as "SKIPPED: <code> (reason)".
- If the same "Claim Credit" button appears in your recent actions twice in a row without you successfully submitting, navigate to summary and skip that session.
- Do NOT click Cancel or Back inside an evaluation.
- Track count: emit done with the actual number of sessions you successfully claimed.`;

const HN_TOP_STORY_TASK = `Look at the Hacker News front page (the table of stories). Find the story currently ranked #1 (the very first story in the list). Emit done with the result containing both the story's title and its score in points, formatted as: "<title> — <N> points".`;

export const DEFAULT_PRESETS: TaskPreset[] = [
  {
    id: 'arrs-cme-batch',
    name: 'ARRS — claim all CME credits',
    url: 'https://apps.arrs.org/VAM26/ClaimCredit/Summary',
    task: ARRS_BATCH_TASK,
    maxStepsOverride: 200,
  },
  {
    id: 'hn-top-story',
    name: 'Hacker News — what\'s the top story',
    url: 'https://news.ycombinator.com',
    task: HN_TOP_STORY_TASK,
    maxStepsOverride: 10,
  },
];
