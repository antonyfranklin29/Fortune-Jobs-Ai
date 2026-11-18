import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileRoles, classifyRole } from '../supabase/functions/job-ingest/lib.mjs';
import { ROLES as adzuna } from '../supabase/functions/job-ingest/config.mjs';
import { ROLES as usa } from '../supabase/functions/usajobs-ingest/config.mjs';
import { ROLES as ats } from '../supabase/functions/ats-ingest/config.mjs';
const config = JSON.parse(readFileSync(new URL('../config/job-roles.json', import.meta.url)));
const roles = compileRoles(config);
const cases = {
  'network-engineer': ['Senior Network Engineer', 'Network Architect II'],
  'systems-administrator': ['Systems Administrator II', 'Linux Administrator', 'Unix Admin', 'Sysadmin'],
  'it-support': ['IT Support Specialist', 'Help Desk Technician', 'Helpdesk Analyst', 'Desktop Support Engineer', 'Service Desk Analyst'],
  'database-administrator': ['Senior Database Administrator', 'Oracle DBA', 'SQL Server Administrator'],
  'solutions-architect': ['Principal Solutions Architect', 'Solution Architect', 'AWS Architect', 'Data Architect'],
  'security-engineer': ['Application Security Engineer', 'Cybersecurity Engineer', 'Penetration Tester', 'Pentester'],
  'sap-consultant': ['SAP S/4HANA Consultant', 'ERP Functional Consultant', 'Senior Consultant - SAP'],
  'embedded-engineer': ['Embedded Engineer', 'Firmware Engineer', 'Firmware Developer'],
  'ux-ui-designer': ['UX Designer', 'UI/UX Designer', 'UX/UI Designer', 'User Experience Designer'],
  'technical-program-manager': ['Senior Technical Program Manager', 'TPM - Infrastructure'],
  'it-auditor': ['IT Auditor II', 'Information Systems Auditor', 'GRC Analyst', 'Governance, Risk and Compliance Analyst'],
};
for (const [id, titles] of Object.entries(cases)) {
  test(id + ' accepts realistic titles', () => {
    for (const title of titles) assert.equal(classifyRole(title, roles), id, title);
  });
}
test('unrelated job titles do not become tech roles', () => {
  for (const title of ['Network Marketing Manager', 'Sales Engineer', 'Social Network Engineer',
    'Physical Security Engineer', 'Fire Alarm Engineer', 'Landscape Architect', 'Database Sales Representative',
    'Customer Support Representative', 'Graphic Designer', 'Program Manager', 'Financial Auditor',
    'Total Productive Maintenance TPM Manager', 'SAP Warehouse Associate']) {
    assert.ok(!Object.hasOwn(cases, classifyRole(title, roles)), title);
  }
});
test('existing roles keep first priority even in overlapping titles', () => {
  const old = compileRoles({ roles: config.roles.slice(0, 26) });
  for (const [title, expected] of [
    ['Data Engineer - Cloud Architecture', 'data-engineer'],
    ['Cloud Architect', 'cloud-engineer'], ['Site Reliability Engineer', 'devops-engineer'],
    ['Mobile Developer', 'software-engineer'], ['Embedded Software Engineer', 'software-engineer'],
    ['Cybersecurity Analyst', 'cybersecurity-analyst'], ['IT Specialist (SYSADMIN)', 'devops-engineer'],
    ['Software Engineer - Security Engineer', 'software-engineer'],
    ['Project Manager - Technical Program Manager', 'project-manager'],
  ]) {
    assert.equal(classifyRole(title, old), expected);
    assert.equal(classifyRole(title, roles), expected);
  }
});
test('all generated worker configs match the canonical taxonomy', () => {
  for (const generated of [adzuna, usa, ats]) assert.deepEqual(generated, config);
});
import { PGlite } from '@electric-sql/pglite';
import { compileRoles as atsCompile, classifyRole as atsClassify } from '../supabase/functions/ats-ingest/core.mjs';
import { compileRoles as usaCompile, classifyRole as usaClassify } from '../supabase/functions/usajobs-ingest/core.mjs';

test('ATS and USAJOBS classify each new title identically', () => {
  for (const [compile, classify, config] of [[atsCompile, atsClassify, ats], [usaCompile, usaClassify, usa]]) {
    const compiled = compile(config);
    for (const [expected, titles] of Object.entries(cases)) {
      for (const title of titles) assert.equal(classify(title, compiled), expected, title);
    }
  }
});
test('pending SQL classifier agrees with workers and seeds all roles without touching jobs', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role;');
    await db.exec(readFileSync(new URL('../migrations/pending/20261117_more_tech_roles.sql', import.meta.url), 'utf8'));
    const titles = [...Object.values(cases).flat(), 'Cloud Architect', 'Embedded Software Engineer',
      'Data Engineer - Solutions Architect', 'Cybersecurity Analyst', 'Network Marketing', 'Sales Engineer'];
    for (const title of titles) {
      const { rows } = await db.query('select public.ingest_classify_role($1) as role', [title]);
      assert.equal(rows[0].role, classifyRole(title, roles), title);
    }
    const { rows } = await db.query('select count(*)::int as count from public.ingest_roles');
    assert.equal(rows[0].count, 37);
  } finally { await db.close(); }
});
