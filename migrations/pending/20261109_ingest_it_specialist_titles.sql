-- Federal 'IT Specialist (CODE)' titles (USAJobs series 2210) count toward the matching existing IT role,
-- e.g. IT Specialist (INFOSEC) -> cybersecurity-analyst. Generated rule from config/job-roles.json via
-- scripts/build-ingest-sql.cjs; no new role, so Adzuna coverage and budget are unchanged. Existing rows untouched.
create or replace function public.ingest_classify_role(p_title text)
returns text language plpgsql immutable set search_path = public, pg_temp as $$
declare t text := coalesce(p_title, '');
begin
  if (t ~* '\ydata\s+(?:&|and)?\s*(?:\w+\s+)?analyst\y' or t ~* '\yanalytics\s+analyst\y' or t ~* '\yreporting\s+(?:&\s+)?(?:data\s+)?analyst\y' or t ~* '\ydata\s+insights?\s+analyst\y') and not (t ~* '\ydata\s+engineer' or t ~* '\ydata\s+scien' or t ~* '\ydata\s+entry\y' or t ~* '\ydatabase\s+admin' or t ~* '\ysecurity\s+analyst\y' or t ~* '\ydata\s+center\y' or t ~* '\yarchitect\y') then return 'data-analyst'; end if;
  if (t ~* '\ybusiness\s+(?:systems\s+)?analyst\y' or t ~* '\y(?:it|information\s+technology)\s+specialist\y.*\([^)]*\y(?:sysanalysis|plcypln)\y') and not (t ~* '\ybusiness\s+data\s+analyst\y') then return 'business-analyst'; end if;
  if (t ~* '\y(?:business\s+intelligence|bi)\s+(?:developer|engineer)\y') and not false then return 'business-intelligence-developer'; end if;
  if (t ~* '\ypower\s*bi\y.*\y(?:developer|engineer|consultant)\y') and not false then return 'power-bi-developer'; end if;
  if (t ~* '\ytableau\y.*\y(?:developer|engineer|consultant)\y') and not false then return 'tableau-developer'; end if;
  if (t ~* '\ysql\s+(?:server\s+)?developer\y') and not false then return 'sql-developer'; end if;
  if (t ~* '\ydata\s+engineer\y' or t ~* '\y(?:it|information\s+technology)\s+specialist\y.*\([^)]*\ydatamgt\y') and not false then return 'data-engineer'; end if;
  if (t ~* '\ydata\s+scientist\y') and not false then return 'data-scientist'; end if;
  if (t ~* '\y(?:machine\s+learning|ml)\s+engineer\y' or t ~* '\y(?:ai|artificial\s+intelligence)\s+engineer\y') and not false then return 'machine-learning-engineer'; end if;
  if (t ~* '\ysoftware\s+(?:engineer|developer)\y' or t ~* '(?:\y(?:java|python|c\+\+|golang|ruby|php|javascript|typescript|react|angular|node(?:\.js)?|ios|android|mobile|front[\s-]*end|back[\s-]*end|web)|\.net|\yc#)\s+(?:software\s+)?(?:developer|engineer|programmer)\y' or t ~* '\y(?:it|information\s+technology)\s+specialist\y.*\([^)]*\yappsw\y') and not (t ~* '\ytest\y' or t ~* '\yqa\y' or t ~* '\ysales\y' or t ~* '\ysupport\s+engineer\y') then return 'software-engineer'; end if;
  if (t ~* '\yfull[\s-]*stack\y') and not false then return 'full-stack-developer'; end if;
  if (t ~* '\ydevops\y' or t ~* '\ysite\s+reliability\s+engineer\y' or t ~* '\y(?:it|information\s+technology)\s+specialist\y.*\([^)]*\y(?:sysadmin|network|inet|os)\y') and not false then return 'devops-engineer'; end if;
  if (t ~* '\ycloud\s+(?:engineer|architect)\y' or t ~* '\y(?:it|information\s+technology)\s+specialist\y.*\([^)]*\y(?:entarch|cloud)\y') and not false then return 'cloud-engineer'; end if;
  if (t ~* '\y(?:qa|quality\s+assurance|test(?:ing)?|sdet)\y.*\y(?:engineer|analyst|tester)\y') and not false then return 'qa-engineer'; end if;
  if (t ~* '\y(?:cyber\s*security|information\s+security|security|soc)\s+analyst\y' or t ~* '\y(?:it|information\s+technology)\s+specialist\y.*\([^)]*\y(?:infosec|cyber|security)\y' or t ~* '\y(?:it|information\s+technology)\s+cyber\s*security\s+specialist\y') and not false then return 'cybersecurity-analyst'; end if;
  if (t ~* '\yservicenow\y') and not false then return 'servicenow-developer'; end if;
  if (t ~* '\ysalesforce\y.*\y(?:developer|engineer)\y') and not false then return 'salesforce-developer'; end if;
  if (t ~* '\yanaplan\y') and not false then return 'anaplan-model-builder'; end if;
  if (t ~* '\yproduct\s+manager\y') and not false then return 'product-manager'; end if;
  if (t ~* '\yproject\s+manager\y') and not false then return 'project-manager'; end if;
  if (t ~* '\yregistered\s+nurse\y' or t ~* '\yrn\y') and not (t ~* '\ynurse\s+practitioner\y') then return 'registered-nurse'; end if;
  if (t ~* '\yaccountant\y') and not false then return 'accountant'; end if;
  if (t ~* '\ymarketing\s+manager\y') and not false then return 'marketing-manager'; end if;
  if (t ~* '\y(?:human\s+resources|hr)\s+manager\y') and not false then return 'human-resources-manager'; end if;
  if (t ~* '\ysales\s+(?:representative|rep)\y') and not false then return 'sales-representative'; end if;
  if (t ~* '\ycustomer\s+service\s+(?:representative|rep|associate)\y') and not false then return 'customer-service-representative'; end if;
  return null;
end $$;
revoke all on function public.ingest_classify_role(text) from public, anon, authenticated;
grant execute on function public.ingest_classify_role(text) to service_role;
