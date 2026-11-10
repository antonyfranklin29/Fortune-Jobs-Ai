import React, { useState } from 'react';
import { PRO, goToBilling, isActive, proVisible } from './billing.js';

/** The Pro offer under search results, or a short "You're Pro" note for members. */
export function ProCard({ subscription }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pro = isActive(subscription);
  async function subscribe() { setBusy(true); setError(''); const e = await goToBilling('checkout'); if (e) { setError(e); setBusy(false); } }
  if (pro) return <section className="dashboard-upgrade dashboard-upgrade-pro" aria-label="Fortune Jobs AI Pro">
    <div className="dashboard-upgrade-top"><span>Fortune Jobs AI Pro</span><span>Active ✓</span></div>
    <p>{PRO.resultsLabel} results per search and {PRO.aiPerDay} AI Coach actions a day.</p>
    <a href="./profile.html#subscription">Manage subscription →</a>
  </section>;
  const open = proVisible();
  return <section className="dashboard-upgrade" aria-labelledby="dashboard-upgrade-title">
    <div className="dashboard-upgrade-top"><span>Fortune Jobs AI Pro</span><span>{open ? `${PRO.price}/mo` : 'Coming soon'}</span></div>
    <h3 id="dashboard-upgrade-title">See up to {PRO.results / PRO.freeResults}× more jobs</h3>
    <ul className="pro-perks"><li>{PRO.resultsLabel} results per search (free: {PRO.freeResults})</li><li>{PRO.aiPerDay} AI Coach actions a day (free: {PRO.freeAiPerDay})</li><li>Cancel anytime</li></ul>
    <p className="dashboard-upgrade-price"><strong>{PRO.price}</strong><span>/ month</span></p>
    {open ? <><button type="button" className="pro-subscribe" onClick={subscribe} disabled={busy}>{busy ? 'Opening secure checkout…' : 'Subscribe to Pro'}</button>
    <p className="pro-fine">Renews monthly at {PRO.price} until you cancel. Cancel anytime from your profile; Pro stays on until the end of the month you paid for. Full refund within 7 days of your first payment. Payments are handled by Stripe. <a href="./terms.html#refunds">Refund policy</a> · <a href="./terms.html#pro">Terms</a></p></> : <p className="pro-fine">Pro is launching soon.</p>}
    {error && <p className="ai-error" role="alert">{error}</p>}
  </section>;
}

/** Subscription status and controls for the profile page. */
export function SubscriptionSection({ subscription, welcome = false }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pro = isActive(subscription);
  async function go(action) { setBusy(true); setError(''); const e = await goToBilling(action); if (e) { setError(e); setBusy(false); } }
  const until = subscription?.current_period_end ? new Date(subscription.current_period_end).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '';
  return <section className="profile-subscription" id="subscription" aria-labelledby="subscription-title">
    <h2 id="subscription-title">Subscription</h2>
    {welcome && pro && <p className="pro-welcome" role="status">Welcome to Pro! Your extra results and AI actions are on.</p>}
    {welcome && !pro && <p className="pro-welcome" role="status">Thanks! Your payment is being confirmed. This page will show Pro within a minute; refresh if it doesn’t.</p>}
    {pro ? <>
      <p><strong>Fortune Jobs AI Pro</strong> · {PRO.price}/month · {subscription.cancel_at_period_end ? `Ends on ${until}` : `Renews on ${until}`}</p>
      <p>{PRO.resultsLabel} results per search and {PRO.aiPerDay} AI Coach actions a day.</p>
      <button type="button" onClick={() => go('portal')} disabled={busy}>{busy ? 'Opening…' : 'Manage or cancel'}</button>
    </> : !proVisible() && !subscription?.stripe_subscription_id && subscription?.status !== 'past_due' ? <p>You’re on the free plan: {PRO.freeResults} results per search and {PRO.freeAiPerDay} AI Coach actions a day. Pro is launching soon.</p> : <>
      <p>You’re on the free plan: {PRO.freeResults} results per search and {PRO.freeAiPerDay} AI Coach actions a day.</p>
      {subscription?.status === 'past_due' && <p className="ai-error">Your last Pro payment didn’t go through. Update your card to keep Pro.</p>}
      <button type="button" onClick={() => go(subscription?.status === 'past_due' ? 'portal' : 'checkout')} disabled={busy}>{busy ? 'Opening…' : subscription?.status === 'past_due' ? 'Update card' : `Get Pro for ${PRO.price}/month`}</button>
    </>}
    {error && <p className="ai-error" role="alert">{error}</p>}
  </section>;
}
