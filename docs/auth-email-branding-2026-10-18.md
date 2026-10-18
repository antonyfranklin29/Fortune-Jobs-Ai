# Fortune Jobs AI authentication email branding

`auth-email/confirm-signup.html` is the source for Supabase Authentication > Emails > Confirm sign up. Subject: `Confirm your Fortune Jobs AI account`. Preserve the `{{ .ConfirmationURL }}` placeholder in both links. This is a transactional account message; newsletter consent and unsubscribe controls do not belong in it.

The confirmation subject and HTML were saved in the production Supabase dashboard on 2026-10-18. Reloading the page showed the saved subject and branded preview. A live delivered email has not yet been checked; previously sent emails cannot be changed retroactively.

Changing the HTML and subject does not change the sender. Production custom SMTP was off when checked on 2026-10-18, so the default sender still appears as Supabase Auth. Configure a verified transactional sender through Supabase Authentication > Emails > SMTP Settings (for example, a verified `no-reply@fortunejobsai.com` mailbox or sending service), with sender name `Fortune Jobs AI`. Never commit SMTP credentials. Once configured, send a test signup to a controlled inbox and verify sender, rendering, confirmation-link behavior, SPF/DKIM/DMARC and reply handling. Apply a similar visual style to password reset and email-change templates before launch.

Resend currently redirects to its login screen in the available Chrome session, so its domain status and SMTP credentials could not be checked. Do not switch on Supabase custom SMTP until the sending domain and credentials are ready. The separate weekly newsletter remains disabled.
