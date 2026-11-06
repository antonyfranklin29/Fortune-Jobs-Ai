// Informational pages ported from about.html, privacy.html, terms.html and
// contact.html. The wording is copied exactly from the static pages: change it
// only with a reviewed policy update, never as part of a code change.
import React from 'react';

export function AboutPage() {
  return <>
<nav>
  <a href="index.html" className="logo">
    <div className="logo-icon">
      <svg width="20" height="20" viewBox="0 0 22 22" fill="none">
        <path d="M3 14 L7 8 L11 14 L15 9 L19 15" stroke="#0F172A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="7" cy="8" r="2" fill="#0F172A" />
        <circle cx="15" cy="9" r="2" fill="#0F172A" />
        <circle cx="19" cy="15" r="2" fill="#0F172A" />
      </svg>
    </div>
    <span className="logo-text">Fortune Jobs AI</span>
  </a>
  <ul className="nav-links">
    <li><a href="index.html">Home</a></li>
    <li><a href="about.html">About</a></li>
    <li><a href="find-jobs.html" className="find-jobs-link">Find Jobs</a></li>
    <li><a href="employers.html">For employers</a></li>
  </ul>
  <div className="nav-account" id="navAccount">
    <a href="login.html" className="nav-login">Job seeker sign in</a>
    <a href="login.html?mode=signup" className="nav-cta">Sign up free</a>
  </div>
</nav><main className="hero" style={{ maxWidth: '960px', margin: 'auto', textAlign: 'left', minHeight: '65vh' }}>
<div className="hero-badge">ABOUT FORTUNE JOBS AI</div>
<h1>Your next opportunity,<br /><span>within reach.</span></h1>
<p className="hero-sub-text" style={{ marginLeft: '0' }}>Fortune Jobs AI helps job seekers discover opportunities that fit their interests, skills and career goals.</p>
<h2 style={{ margin: '36px 0 16px' }}>A clearer way to search</h2>
<p style={{ lineHeight: '1.9', color: 'var(--gray-400)' }}>Explore saved opportunities with Quick Match or look for fresh listings with Live Search. Choose a job title, location and the filters that matter to you, then review your matches on a dedicated results page.</p>
<h2 style={{ margin: '32px 0 16px' }}>Built around your next step</h2>
<p style={{ lineHeight: '1.9', color: 'var(--gray-400)' }}>Compare roles, see why they may fit your search, and follow application links to take the next step. Create an account to save opportunities and keep your job search organized.</p>
<p style={{ lineHeight: '1.9', color: 'var(--gray-400)', marginTop: '24px' }}>Our aim is to make discovering relevant work simpler and more focused, whether you are starting your career or exploring a new direction.</p>
<a href="find-jobs.html" className="upsell-btn" style={{ marginTop: '32px' }}>Find Jobs →</a>
</main><footer><p>© 2026 YOU DO LMS INC. All rights reserved. Fortune Jobs AI is operated by YOU DO LMS INC. · <a href="terms.html">Terms</a> · <a href="privacy.html">Privacy</a> · <a href="contact.html">Contact & Feedback</a> · <a href="mailto:info@fortunejobsai.com">info@fortunejobsai.com</a></p></footer>

  </>;
}

export function PrivacyPage() {
  return <>
<nav className="top-nav"><a className="logo-text logo" href="index.html">Fortune Jobs AI</a><div><a className="nav-link" href="about.html">About</a><a className="nav-link" style={{ color: 'var(--gold)' }} href="find-jobs.html">Find Jobs</a></div></nav><main><h1>Privacy information</h1><p>Updated November 6, 2026</p><div className="notice">Fortune Jobs AI is preparing for launch. These details describe the current product. You can delete your account from your profile or contact us by email with privacy questions.</div>
<h2>Who we are</h2><p>Fortune Jobs AI is operated by YOU DO LMS INC., a New Jersey corporation. YOU DO LMS INC. is responsible for the personal information described on this page. Mailing address: 1553 Route 27, Suite 1000, Somerset, NJ 08873, United States. Email: <a href="mailto:info@fortunejobsai.com">info@fortunejobsai.com</a>.</p>
<h2>Searching for jobs</h2><p>Search terms and chosen location and filters are processed to find matching listings. Live Search sends those search settings to external job-search processing services. Searches have separate identifiers. Job listings are public information and matching does not guarantee employment or eligibility.</p>
<h2>Guest resume matching</h2><p>Supported PDF and DOCX documents are read in your browser. The guest document is not uploaded to resume storage. Reduced role, skills, experience and home-area details are kept in this tab's temporary storage with a two-hour validity period. Expired details are discarded the next time the matching tools access them. Clear them with the Clear resume details option. Search links contain the job title, selected area and an opaque matching identifier. Avoid sharing those links if you want to keep your search private.</p>
<h2>Résumé workspace and fit estimates</h2><p>The résumé workspace formats details you enter in your browser tab. If you choose to review your saved profile, it reads your name, email, current title, confirmed skills and preferred location from your account; you decide whether to add them to the draft. If you select an existing text-based PDF or DOCX, the workspace reads the file locally and shows editable title and skill suggestions. The workspace does not save the draft or imported file to your account or send them to an AI provider. Closing or refreshing the tab discards the draft. If you print or save a PDF, that copy is controlled by your browser and device. Job-specific fit estimates compare confirmed résumé details with available listing text in your browser. They may be incomplete and are not hiring predictions.</p>
<h2>Accounts and uploaded files</h2><p>An account stores your sign-in email and the profile details you save, including your skills, experience, preferences, saved jobs and search history. Saving a resume to your profile stores the original file and extracted text. Resume files use private storage with temporary access links. Profile photos use public image URLs: anyone with the URL can view the photo.</p>
<h2>Employer workspaces</h2><p>Employer sign-in uses the same account identity as job-seeker sign-in, with a separate company workspace. We store company names, website domains, membership, job drafts and review history to verify companies and manage postings. Company details and job content become public only through approval. Permission evidence and review notes are kept private. Closing an account removes its membership and personal account references; company and job history may remain. A company without an active owner is paused or rejected, and reviewer-approved feeds may require another review.</p>
<h2>Your controls</h2><p>In your profile you can edit details, remove your resume and extracted text, remove saved jobs and clear search history. Download my data exports your stored profile, saved jobs, search history and email preferences; original files are not included. Store that download privately. Delete your account, at the bottom of your profile, permanently deletes your profile, extracted resume text, uploaded resume and photo files, saved jobs, search history and email preferences, then closes your account. You may be asked to sign in again first. Deleted data cannot be restored. Live Search usage records are kept without your account attached. If you are the last owner of an employer company, its live listings are closed.</p>
<h2>Service providers and technical information</h2><p>External services provide account authentication, cloud database and file storage, job-search processing, location suggestions and web assets. They may receive technical information such as IP address and request logs. Account sign-in uses browser storage to keep you signed in. Guest resume details use temporary tab storage. Resume text and account identity are not included in the live-search request.</p>
<h2>Optional job alert emails</h2><p>Creating an account or signing in with Google does not subscribe you to marketing emails. If you opt in on the email preferences page, we email new job listings that match the job title on your profile and your search area, daily or weekly as you choose, and skip the email when there are no new matches. Our email delivery provider (Resend) processes your email address, first name and the message content; your résumé is not sent to it. Every email has an unsubscribe link, and you can change or stop alerts at any time on the email preferences page. Account and security messages are separate.</p><h2>Retention and security</h2><p>Guest matching details expire after two hours and are discarded on the next matching-tool access. Account data remains stored until changed or removed; there is no automatic account-data expiry schedule yet. Database access rules restrict private account records to their owner. We are still completing backup, recovery, abuse-prevention and security checks, and cannot promise uninterrupted service.</p>
<h2>Contact and requests</h2><p>For privacy questions, deletion requests or feedback, email <a href="mailto:info@fortunejobsai.com">info@fortunejobsai.com</a>. Please do not send passwords or private documents. See our <a href="contact.html">contact page</a> for more help.</p></main><footer><a href="privacy.html">Privacy</a> · <a href="contact.html">Contact</a></footer>

  </>;
}

export function TermsPage() {
  return <>
<nav className="top-nav"><a className="logo-text logo" href="index.html">Fortune Jobs AI</a><div><a className="nav-link" href="find-jobs.html">Find jobs</a><a className="nav-link" href="contact.html">Contact</a></div></nav>
<main>
<h1>Terms of Use</h1>
<p>Effective November 6, 2026</p>
<div className="notice">Fortune Jobs AI is a job-discovery service in preparation for launch. Search results may be limited while job feeds and employer posting are being tested. No paid subscription or employer publishing plan is available today.</div>
<h2>Who provides the service</h2>
<p>These terms are an agreement between you and YOU DO LMS INC. (“we”, “us”), a New Jersey corporation that operates Fortune Jobs AI at fortunejobsai.com. Mailing address: 1553 Route 27, Suite 1000, Somerset, NJ 08873, United States.</p>
<h2>Using the service</h2>
<p>You may search jobs without an account. An account is needed for features such as saved jobs, a profile and an employer workspace. Use accurate account information, protect your sign-in, and contact us if you suspect unauthorized access. Do not use the service to impersonate someone, attack it, bypass its limits, harvest personal data or submit unlawful content.</p>
<h2>Job listings and applications</h2>
<p>Listings may come from external job providers or approved employers. We try to show useful, current information, but a listing, salary, location, work arrangement or application link may change or be wrong. Search rankings and match scores are estimates for discovery; they are not a hiring decision, a guarantee of eligibility, an offer of employment or professional career advice. Check the original listing and the employer before sharing sensitive information or applying.</p>
<p>Application links may take you to a third-party website with its own terms and privacy practices. Fortune Jobs AI does not control that website or the employer's hiring decisions. Do not pay a supposed employer to obtain a job. If a listing seems false, discriminatory, unsafe or closed, report its link to <a href="mailto:info@fortunejobsai.com?subject=Report%20a%20job%20listing">info@fortunejobsai.com</a>.</p>
<h2>Employer submissions</h2>
<p>Where employer posting is available, a company representative must be authorized to act for the organization and to provide its domain, job content and application link. Domain verification alone does not guarantee approval. Posts and career feeds require independent review before publication. Employers must keep roles, locations, compensation information where supplied, and application links accurate and current, and promptly close filled or withdrawn roles.</p>
<p>Employers may not submit fake or misleading opportunities, discriminatory ads, unlawful recruitment requirements, malware, or posts that require applicants to pay to get a job. They must have the rights needed for us to display and format submitted content and must comply with employment, privacy and advertising laws that apply to their postings and hiring process. We may reject, pause, remove or correct a post or feed when necessary to protect users or comply with law. Approved companies can have up to 15 active posts under the current free allowance; drafts and posts awaiting review do not count as active.</p>
<p>Submitting content gives Fortune Jobs AI permission to store, review, format and display it for the job-discovery service while the submission remains authorized. The employer keeps responsibility for its content and application process. A third-party feed or job listing does not become the employer's own post merely because it appears in search.</p>
<h2>Plans and communications</h2>
<p>Paid plans are being planned but are not available, and we are not collecting subscription payments. Prices shown on the site are proposals until checkout terms are published and billing is enabled. Creating an account, using Google sign-in or searching does not sign you up for a paid plan or the optional marketing newsletter. Account and security emails may still be sent to operate your account. See <a href="privacy.html">Privacy information</a> for data handling and email choices.</p>
<h2>Availability and changes</h2>
<p>Features and listings may be unavailable or change during testing. We may restrict access that threatens the service, other users or legal compliance. We will post updates to these terms with a new effective date and seek any additional agreement required before applying material new terms. These terms do not remove rights that applicable law does not allow us to waive.</p>
<h2>Questions and reports</h2>
<p>For help, accessibility barriers, copyright or listing concerns, or questions about these terms, email <a href="mailto:info@fortunejobsai.com">info@fortunejobsai.com</a>. Identify the page or listing URL and the concern; do not email passwords, payment information or private documents.</p>
</main>
<footer><a href="terms.html">Terms</a> · <a href="privacy.html">Privacy</a> · <a href="contact.html">Contact</a></footer>

  </>;
}

export function ContactPage() {
  return <>
<nav className="top-nav"><a className="logo-text logo" href="index.html">Fortune Jobs AI</a><div><a className="nav-link" href="about.html">About</a><a className="nav-link" style={{ color: 'var(--gold)' }} href="find-jobs.html">Find Jobs</a></div></nav><main><h1>Contact Fortune Jobs AI</h1><div className="notice"><strong>We’d like to hear from you.</strong><p>For questions, feedback, feature suggestions or problems with Fortune Jobs AI, email <a href="mailto:info@fortunejobsai.com">info@fortunejobsai.com</a>.</p><p>Tell us what you were trying to do and what happened so we can improve your experience. Please do not include passwords, payment details or private documents.</p></div><h2>Company details</h2><p>Fortune Jobs AI is operated by YOU DO LMS INC., a New Jersey corporation. Mailing address: 1553 Route 27, Suite 1000, Somerset, NJ 08873, United States. Email is the fastest way to reach us.</p><h2>Need to change your data?</h2><p>If you have an account, your <a href="profile.html">profile page</a> lets you update your information, remove your resume, clear search history, remove saved jobs and download your data. Guest resume results include a Clear resume details option.</p><h2>Search help</h2><p>Quick Match searches saved listings. Live Search looks for fresh listings. Narrow filters may return fewer than ten jobs, or none. Try adjusting the location or filters. Uploads support text-based PDF and DOCX; scanned documents need conversion first.</p><h2>Subscriptions</h2><p>The planned Pro price is $7.99 per month, with any applicable taxes shown before purchase. Payments are not enabled yet.</p><h2>Privacy and account deletion</h2><p>For privacy questions or an account-deletion request, email <a href="mailto:info@fortunejobsai.com?subject=Privacy%20request">info@fortunejobsai.com</a>. Complete self-service account deletion is still being prepared. Read our <a href="privacy.html">current privacy information</a> for available controls.</p></main><footer><a href="privacy.html">Privacy</a> · <a href="contact.html">Contact</a></footer>

  </>;
}
