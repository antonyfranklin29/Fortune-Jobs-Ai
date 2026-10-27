# Employer reviewer queue, October 27, 2026

The reviewer queue previously showed only a pending job's title and application URL. A reviewer could approve without seeing the description, work arrangement, location or dates they were approving. It also omitted the account email for a company claim, making independent company-contact checks harder.

The live `operator_queue()` function now returns the registrant's current account email for a pending company and the full submitted job revision for a pending post. The employer workspace shows those facts in an expandable review section; its Approve button is there and is disabled if a description is unavailable. Rejection remains available with a recorded reason. The database still enforces reviewer membership, prevents self-review, and binds post approval to the exact revision. No employer can gain reviewer status from the page.

Production verification after applying the SQL: the function definition contains both new fields; anonymous EXECUTE is false and signed-in EXECUTE is true. The function's own `employer_require_operator` check remains in place. There are **zero** rows in `employer_operators`; no reviewer was granted and no company or post was approved. The front-end change still needs publication and a real reviewer acceptance test.

Local tests: `tests/employer-workspace.cjs` confirms the reviewer can see job facts, the button is unavailable when the backend omits a description, and the submitted revision is sent for approval. `tests/employer-auto-approval.mjs` confirms the backend returns the private details to a reviewer and refuses an ordinary user. The full `npm test` suite passed 249/249 before publication.

Next operational step: Franklin appoints an independent trusted reviewer who does not belong to the company being reviewed. The reviewer should verify company authority through a separate contact channel or documented record, store only a short evidence reference in the note, then test one authorized company and post end to end. Do not grant Franklin's employer account permission to review its own company.
