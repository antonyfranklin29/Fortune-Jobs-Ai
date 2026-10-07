"""Generate job-titles.js — the suggestion list for the job title box."""
import json, sys

# Technology / tool families -> the role names that actually exist for them
TECH = {
    "Power BI": ["Developer", "Analyst", "Data Analyst", "Consultant", "Engineer", "Architect", "Administrator",
                 "Report Developer", "Dashboard Developer", "Specialist", "Lead", "Data Modeler", "Business Analyst",
                 "Solutions Architect", "Trainer"],
    "Tableau": ["Developer", "Analyst", "Consultant", "Engineer", "Architect", "Administrator", "Dashboard Developer", "Specialist"],
    "Looker": ["Developer", "Analyst", "Engineer"],
    "Qlik": ["Developer", "Consultant", "Analyst"],
    "Business Intelligence": ["Developer", "Analyst", "Engineer", "Consultant", "Architect", "Manager", "Lead", "Specialist", "Data Analyst"],
    "BI": ["Developer", "Analyst", "Engineer", "Consultant", "Architect", "Manager", "Lead"],
    "Data": ["Analyst", "Engineer", "Scientist", "Architect", "Modeler", "Governance Analyst", "Governance Manager",
             "Quality Analyst", "Entry Clerk", "Entry Specialist", "Operations Analyst", "Product Manager", "Platform Engineer",
             "Warehouse Engineer", "Warehouse Developer", "Visualization Specialist", "Visualization Developer",
             "Steward", "Manager", "Analytics Manager", "Integration Engineer", "Migration Specialist", "Annotator", "Labeler"],
    "Analytics": ["Engineer", "Manager", "Consultant", "Director", "Lead", "Specialist", "Translator"],
    "SQL": ["Developer", "Analyst", "Database Administrator", "Server DBA", "Data Engineer", "Report Writer"],
    "Database": ["Administrator", "Developer", "Engineer", "Architect", "Analyst"],
    "ETL": ["Developer", "Engineer", "Architect", "Tester"],
    "Snowflake": ["Developer", "Data Engineer", "Architect", "Administrator"],
    "Databricks": ["Engineer", "Data Engineer", "Architect", "Developer"],
    "Azure": ["Data Engineer", "Developer", "Cloud Engineer", "Architect", "Solutions Architect", "Administrator", "DevOps Engineer", "Data Factory Developer"],
    "AWS": ["Cloud Engineer", "Solutions Architect", "Developer", "DevOps Engineer", "Data Engineer", "Administrator", "Security Engineer"],
    "Google Cloud": ["Engineer", "Architect", "Data Engineer", "Developer"],
    "Cloud": ["Engineer", "Architect", "Administrator", "Security Engineer", "Consultant", "Support Engineer", "Operations Engineer"],
    "Anaplan": ["Model Builder", "Solution Architect", "Consultant", "Developer", "Analyst", "Administrator"],
    "Salesforce": ["Developer", "Administrator", "Admin", "Consultant", "Architect", "Business Analyst", "Analyst", "Engineer", "Marketing Cloud Developer", "CPQ Developer"],
    "SAP": ["Consultant", "Analyst", "Developer", "ABAP Developer", "FICO Consultant", "MM Consultant", "SD Consultant", "Basis Administrator", "BW Developer", "Functional Consultant", "Project Manager"],
    "Oracle": ["Developer", "DBA", "Database Administrator", "Consultant", "Financials Consultant", "Fusion Consultant", "Applications Developer"],
    "Workday": ["Consultant", "Analyst", "Administrator", "Integration Developer", "HCM Consultant"],
    "ServiceNow": ["Developer", "Administrator", "Architect", "Consultant"],
    "Dynamics 365": ["Developer", "Consultant", "Functional Consultant", "Administrator"],
    "SharePoint": ["Developer", "Administrator", "Consultant", "Architect"],
    "Power Platform": ["Developer", "Consultant", "Architect"],
    "Power Apps": ["Developer", "Consultant"],
    "Excel": ["Analyst", "VBA Developer", "Specialist"],
    "Python": ["Developer", "Engineer", "Data Engineer", "Backend Developer", "Automation Engineer", "Instructor"],
    "Java": ["Developer", "Engineer", "Full Stack Developer", "Backend Developer", "Architect"],
    "JavaScript": ["Developer", "Engineer"],
    "TypeScript": ["Developer"],
    "React": ["Developer", "Native Developer", "Engineer"],
    "Angular": ["Developer"],
    "Vue": ["Developer"],
    "Node.js": ["Developer", "Backend Developer"],
    ".NET": ["Developer", "Engineer", "Full Stack Developer", "Architect"],
    "C#": ["Developer", "Engineer"],
    "C++": ["Developer", "Engineer"],
    "Go": ["Developer", "Engineer"],
    "Golang": ["Developer"],
    "Rust": ["Developer", "Engineer"],
    "PHP": ["Developer"],
    "Ruby on Rails": ["Developer"],
    "iOS": ["Developer", "Engineer"],
    "Android": ["Developer", "Engineer"],
    "Mobile": ["Developer", "App Developer", "Engineer"],
    "Front End": ["Developer", "Engineer"],
    "Frontend": ["Developer", "Engineer"],
    "Back End": ["Developer", "Engineer"],
    "Backend": ["Developer", "Engineer"],
    "Full Stack": ["Developer", "Engineer"],
    "Web": ["Developer", "Designer", "Analyst"],
    "Software": ["Engineer", "Developer", "Architect", "Development Manager", "Test Engineer", "QA Engineer", "Engineering Manager", "Support Engineer", "Tester"],
    "DevOps": ["Engineer", "Architect", "Manager"],
    "Site Reliability": ["Engineer"],
    "Platform": ["Engineer"],
    "Machine Learning": ["Engineer", "Scientist", "Researcher", "Ops Engineer"],
    "AI": ["Engineer", "Research Scientist", "Product Manager", "Trainer", "Specialist", "Consultant", "Ethics Researcher"],
    "Artificial Intelligence": ["Engineer", "Specialist"],
    "Generative AI": ["Engineer", "Developer"],
    "LLM": ["Engineer"],
    "Prompt": ["Engineer"],
    "Computer Vision": ["Engineer"],
    "NLP": ["Engineer", "Scientist"],
    "QA": ["Engineer", "Analyst", "Tester", "Automation Engineer", "Lead", "Manager"],
    "Quality Assurance": ["Analyst", "Engineer", "Specialist", "Manager", "Inspector"],
    "Test": ["Engineer", "Automation Engineer", "Lead", "Analyst"],
    "Automation": ["Engineer", "Tester", "Developer"],
    "Selenium": ["Tester", "Automation Engineer"],
    "Cybersecurity": ["Analyst", "Engineer", "Specialist", "Consultant", "Architect", "Manager"],
    "Security": ["Analyst", "Engineer", "Architect", "Consultant", "Operations Analyst", "Officer", "Guard"],
    "Information Security": ["Analyst", "Engineer", "Manager", "Officer"],
    "SOC": ["Analyst"],
    "Penetration": ["Tester"],
    "Network": ["Engineer", "Administrator", "Architect", "Technician", "Security Engineer", "Analyst"],
    "Systems": ["Administrator", "Engineer", "Analyst", "Architect"],
    "Linux": ["Administrator", "Engineer"],
    "Windows": ["Administrator", "Systems Engineer"],
    "IT": ["Support Specialist", "Support Technician", "Help Desk Technician", "Manager", "Project Manager", "Business Analyst",
           "Consultant", "Director", "Auditor", "Specialist", "Technician", "Operations Manager", "Asset Manager", "Recruiter"],
    "Help Desk": ["Technician", "Analyst", "Support"],
    "Technical": ["Support Engineer", "Support Specialist", "Writer", "Program Manager", "Project Manager", "Account Manager", "Recruiter", "Trainer", "Lead"],
    "Solutions": ["Architect", "Engineer", "Consultant"],
    "Enterprise": ["Architect", "Account Executive", "Sales Manager"],
    "Product": ["Manager", "Owner", "Designer", "Analyst", "Marketing Manager", "Operations Manager", "Director", "Specialist"],
    "Project": ["Manager", "Coordinator", "Engineer", "Analyst", "Director", "Administrator", "Accountant", "Scheduler"],
    "Program": ["Manager", "Coordinator", "Director", "Analyst", "Specialist"],
    "Scrum": ["Master"],
    "Agile": ["Coach", "Project Manager", "Delivery Lead"],
    "Business": ["Analyst", "Intelligence Analyst", "Development Manager", "Development Representative", "Systems Analyst",
                 "Operations Manager", "Consultant", "Process Analyst", "Manager", "Development Executive", "Office Manager", "Partner"],
    "Financial": ["Analyst", "Advisor", "Controller", "Planner", "Planning Analyst", "Reporting Analyst", "Accountant", "Manager", "Systems Analyst"],
    "FP&A": ["Analyst", "Manager", "Director"],
    "Finance": ["Manager", "Analyst", "Director", "Associate", "Assistant", "Business Partner"],
    "Accounting": ["Manager", "Clerk", "Assistant", "Specialist", "Analyst"],
    "Accounts Payable": ["Specialist", "Clerk", "Manager"],
    "Accounts Receivable": ["Specialist", "Clerk", "Manager"],
    "Payroll": ["Specialist", "Administrator", "Manager", "Clerk"],
    "Tax": ["Accountant", "Manager", "Associate", "Preparer", "Analyst"],
    "Audit": ["Associate", "Manager", "Senior"],
    "Investment": ["Analyst", "Banker", "Banking Analyst", "Associate", "Manager"],
    "Credit": ["Analyst", "Manager", "Risk Analyst"],
    "Risk": ["Analyst", "Manager", "Consultant"],
    "Compliance": ["Analyst", "Officer", "Manager", "Specialist", "Consultant"],
    "Insurance": ["Agent", "Underwriter", "Claims Adjuster", "Broker"],
    "Loan": ["Officer", "Processor", "Underwriter"],
    "Mortgage": ["Loan Officer", "Underwriter", "Processor"],
    "Bank": ["Teller", "Manager"],
    "Marketing": ["Manager", "Coordinator", "Specialist", "Analyst", "Director", "Assistant", "Associate", "Intern", "Operations Manager"],
    "Digital Marketing": ["Manager", "Specialist", "Coordinator", "Analyst", "Executive"],
    "Content": ["Writer", "Strategist", "Manager", "Creator", "Marketing Manager", "Designer", "Moderator"],
    "Social Media": ["Manager", "Specialist", "Coordinator", "Strategist"],
    "SEO": ["Specialist", "Analyst", "Manager"],
    "Growth": ["Marketing Manager", "Manager", "Analyst"],
    "Brand": ["Manager", "Designer", "Strategist", "Ambassador"],
    "Email Marketing": ["Specialist", "Manager"],
    "Performance Marketing": ["Manager", "Specialist"],
    "Sales": ["Representative", "Manager", "Associate", "Executive", "Director", "Engineer", "Operations Analyst", "Development Representative", "Consultant", "Coordinator", "Lead"],
    "Account": ["Executive", "Manager", "Director", "Coordinator"],
    "Customer Success": ["Manager", "Specialist", "Associate", "Director"],
    "Customer Service": ["Representative", "Associate", "Specialist", "Manager", "Advisor", "Agent"],
    "Customer Support": ["Specialist", "Representative", "Engineer", "Agent"],
    "Call Center": ["Representative", "Agent", "Supervisor"],
    "Human Resources": ["Manager", "Generalist", "Coordinator", "Assistant", "Business Partner", "Specialist", "Director"],
    "HR": ["Manager", "Generalist", "Coordinator", "Assistant", "Business Partner", "Specialist", "Analyst", "Director", "Intern"],
    "Talent Acquisition": ["Specialist", "Partner", "Manager", "Coordinator"],
    "Recruitment": ["Consultant", "Coordinator", "Manager"],
    "Benefits": ["Specialist", "Administrator", "Analyst"],
    "Learning and Development": ["Specialist", "Manager"],
    "Training": ["Specialist", "Coordinator", "Manager"],
    "Operations": ["Manager", "Analyst", "Coordinator", "Director", "Associate", "Specialist", "Supervisor"],
    "Supply Chain": ["Analyst", "Manager", "Coordinator", "Planner", "Specialist", "Director"],
    "Logistics": ["Coordinator", "Manager", "Analyst", "Specialist"],
    "Procurement": ["Specialist", "Manager", "Analyst", "Officer"],
    "Purchasing": ["Agent", "Manager", "Assistant"],
    "Inventory": ["Analyst", "Specialist", "Control Specialist", "Manager", "Associate"],
    "Warehouse": ["Associate", "Worker", "Manager", "Supervisor", "Operator"],
    "Demand": ["Planner", "Planning Analyst", "Planning Manager"],
    "Graphic": ["Designer"],
    "UX": ["Designer", "Researcher", "Writer", "Architect"],
    "UI": ["Designer", "Developer"],
    "UX/UI": ["Designer"],
    "Visual": ["Designer"],
    "Interior": ["Designer"],
    "Fashion": ["Designer", "Merchandiser"],
    "Motion": ["Designer", "Graphics Designer"],
    "Video": ["Editor", "Producer"],
    "Game": ["Developer", "Designer", "Tester"],
    "Mechanical": ["Engineer", "Design Engineer", "Technician"],
    "Electrical": ["Engineer", "Technician", "Designer"],
    "Civil": ["Engineer"],
    "Structural": ["Engineer"],
    "Chemical": ["Engineer"],
    "Process": ["Engineer"],
    "Manufacturing": ["Engineer", "Technician", "Manager", "Associate"],
    "Industrial": ["Engineer"],
    "Quality": ["Engineer", "Manager", "Control Inspector", "Technician", "Analyst"],
    "Environmental": ["Engineer", "Scientist", "Specialist"],
    "Biomedical": ["Engineer"],
    "Aerospace": ["Engineer"],
    "Hardware": ["Engineer"],
    "Embedded": ["Software Engineer", "Engineer"],
    "Firmware": ["Engineer"],
    "Field Service": ["Engineer", "Technician"],
    "Maintenance": ["Technician", "Manager", "Supervisor", "Worker"],
    "HVAC": ["Technician", "Installer"],
    "Registered": ["Nurse"],
    "Nurse": ["Practitioner", "Manager", "Educator"],
    "Licensed Practical": ["Nurse"],
    "Medical": ["Assistant", "Receptionist", "Coder", "Billing Specialist", "Scribe", "Technologist", "Director", "Science Liaison"],
    "Clinical": ["Research Associate", "Research Coordinator", "Data Manager", "Pharmacist", "Psychologist", "Nurse Specialist"],
    "Healthcare": ["Administrator", "Data Analyst", "Consultant"],
    "Pharmacy": ["Technician", "Manager"],
    "Physical": ["Therapist", "Therapist Assistant"],
    "Occupational": ["Therapist"],
    "Respiratory": ["Therapist"],
    "Dental": ["Assistant", "Hygienist", "Receptionist"],
    "Lab": ["Technician", "Assistant"],
    "Laboratory": ["Technician", "Manager"],
    "Research": ["Assistant", "Scientist", "Associate", "Analyst", "Coordinator"],
    "Patient": ["Care Technician", "Services Representative", "Care Coordinator"],
    "Home Health": ["Aide"],
    "Certified Nursing": ["Assistant"],
    "Teacher": ["Assistant"],
    "Special Education": ["Teacher"],
    "Elementary School": ["Teacher"],
    "High School": ["Teacher"],
    "Math": ["Teacher", "Tutor"],
    "English": ["Teacher", "Tutor"],
    "ESL": ["Teacher"],
    "Language": ["Teacher", "Interpreter"],
    "Spanish": ["Teacher", "Interpreter", "Translator"],
    "Instructional": ["Designer", "Coordinator"],
    "School": ["Counselor", "Psychologist", "Administrator"],
    "Admissions": ["Counselor", "Coordinator"],
    "Academic": ["Advisor", "Coordinator"],
    "Legal": ["Assistant", "Secretary", "Counsel", "Analyst", "Operations Manager"],
    "Corporate": ["Counsel", "Paralegal", "Trainer", "Recruiter"],
    "Real Estate": ["Agent", "Analyst", "Associate", "Broker", "Manager"],
    "Property": ["Manager", "Administrator", "Accountant"],
    "Leasing": ["Consultant", "Agent", "Manager"],
    "Construction": ["Manager", "Project Manager", "Worker", "Superintendent", "Estimator", "Laborer"],
    "Restaurant": ["Manager", "Server", "Host"],
    "Retail": ["Sales Associate", "Store Manager", "Associate", "Merchandiser", "Assistant Manager"],
    "Store": ["Manager", "Associate", "Assistant Manager"],
    "Hotel": ["Manager", "Front Desk Agent", "Receptionist"],
    "Front Desk": ["Agent", "Receptionist", "Coordinator"],
    "Event": ["Coordinator", "Planner", "Manager"],
    "Travel": ["Agent", "Consultant", "Nurse"],
    "Truck": ["Driver"],
    "Delivery": ["Driver", "Associate"],
    "Forklift": ["Operator"],
    "Machine": ["Operator"],
    "Production": ["Worker", "Supervisor", "Manager", "Planner", "Associate"],
    "Executive": ["Assistant", "Director", "Chef"],
    "Administrative": ["Assistant", "Coordinator", "Specialist", "Manager"],
    "Office": ["Manager", "Assistant", "Administrator", "Coordinator"],
    "Virtual": ["Assistant"],
    "Personal": ["Assistant", "Trainer", "Banker"],
    "Communications": ["Manager", "Specialist", "Coordinator", "Director"],
    "Public Relations": ["Manager", "Specialist", "Coordinator"],
    "PR": ["Manager", "Specialist"],
    "Policy": ["Analyst", "Advisor"],
    "Grant": ["Writer", "Manager"],
    "Nonprofit": ["Program Manager", "Director"],
    "Social": ["Worker"],
    "Case": ["Manager", "Worker"],
    "Mental Health": ["Counselor", "Technician", "Therapist"],
    "Behavioral": ["Health Technician", "Therapist"],
    "Child Care": ["Worker", "Provider"],
    "Enterprise Content Management": ["Analyst", "Business Analyst", "Specialist", "Administrator"],
    "ECM": ["Business Analyst", "Analyst", "Developer", "Administrator"],
    "Document": ["Control Specialist", "Controller", "Management Specialist"],
    "Records": ["Manager", "Clerk", "Specialist"],
    "GIS": ["Analyst", "Specialist", "Technician", "Developer"],
    "Statistical": ["Analyst", "Programmer"],
    "Quantitative": ["Analyst", "Researcher", "Developer"],
    "Actuarial": ["Analyst"],
    "Pricing": ["Analyst", "Manager"],
    "Reporting": ["Analyst", "Specialist", "Developer"],
    "Market Research": ["Analyst"],
    "Research and Development": ["Engineer", "Scientist"],
    "Marketing Analytics": ["Manager", "Analyst"],
    "People Analytics": ["Analyst"],
    "Revenue": ["Operations Manager", "Analyst", "Manager"],
    "Implementation": ["Consultant", "Specialist", "Manager"],
    "Integration": ["Engineer", "Developer", "Specialist"],
    "API": ["Developer"],
    "Blockchain": ["Developer", "Engineer"],
    "Unity": ["Developer"],
    "Unreal": ["Developer"],
    "Shopify": ["Developer", "Expert"],
    "WordPress": ["Developer"],
}
SENIOR_OK = ("Developer", "Engineer", "Analyst", "Architect", "Consultant", "Scientist", "Designer", "Accountant",
             "Manager", "Administrator", "Model Builder", "Specialist")

# Stand-alone titles that don't fit the family pattern
PLAIN = """Accountant
Actuary
Administrative Assistant
Architect
Attorney
Auditor
Bartender
Barista
Bookkeeper
Brand Ambassador
Carpenter
Cashier
Chef
Chief Executive Officer
Chief Financial Officer
Chief Operating Officer
Chief Technology Officer
Chief Marketing Officer
Chief Data Officer
Chief Information Officer
Chief Information Security Officer
Chief of Staff
Cleaner
Consultant
Controller
Cook
Copywriter
Counselor
Courier
Custodian
Data Analyst
Data Engineer
Data Scientist
Dentist
Dietitian
Dispatcher
Driver
Economist
Editor
Electrician
Engineer
Engineering Manager
Esthetician
Financial Analyst
Firefighter
Flight Attendant
General Manager
Graphic Designer
Hairstylist
Housekeeper
Illustrator
Intern
Interpreter
Janitor
Journalist
Laborer
Librarian
Lifeguard
Machinist
Management Consultant
Mechanic
Model Builder
Nanny
Nurse
Nurse Practitioner
Office Manager
Optometrist
Painter
Paralegal
Paramedic
Pharmacist
Photographer
Physician
Physician Assistant
Pilot
Plumber
Police Officer
Principal
Product Manager
Professor
Program Manager
Project Manager
Psychologist
Radiologic Technologist
Receptionist
Recruiter
Sales Associate
Scrum Master
Secretary
Server
Site Manager
Software Engineer
Solutions Architect
Statistician
Store Manager
Surgeon
Surveyor
Teacher
Technical Writer
Technician
Therapist
Translator
Tutor
Underwriter
Veterinarian
Veterinary Technician
Waiter
Welder
Writer
Bilingual Customer Service Representative
World Languages Teacher
Subject Matter Expert
SME
Staffing Coordinator
Staffing Specialist
Technical Recruiter
IT Recruiter
Bench Sales Recruiter
US IT Recruiter
Anaplan Model Builder
Power BI Developer
Data Visualization Analyst
Reporting Analyst
Operations Research Analyst
Supply Chain Analyst
Systems Analyst
Business Systems Analyst
Data Warehouse Architect
Big Data Engineer
Hadoop Developer
Spark Developer
Kafka Engineer
Kubernetes Engineer
Terraform Engineer
Mainframe Developer
COBOL Developer
Informatica Developer
SSIS Developer
SSRS Developer
SSAS Developer
DAX Developer
Alteryx Developer
Alteryx Analyst
dbt Developer
Analytics Engineer
Research Engineer
Founding Engineer
Forward Deployed Engineer
Developer Advocate
Technical Account Manager
Customer Success Engineer
Pre-Sales Engineer
Sales Engineer
Growth Hacker
Community Manager
Influencer Marketing Manager
Ecommerce Manager
Ecommerce Specialist
Dropshipping Specialist
Amazon Account Manager
Store Associate
Stocker
Picker Packer
Package Handler
Material Handler
Line Cook
Dishwasher
Host
Food Runner
Security Guard
Caregiver
Phlebotomist
Medical Coder
Sonographer
Surgical Technologist
EMT
CNA
LPN
RN
""".strip().splitlines()

SKILLS = ["Power BI", "DAX", "Power Query", "Tableau", "SQL", "Python", "R", "Excel", "VBA", "Snowflake", "Databricks",
          "Azure", "AWS", "Google Cloud", "Spark", "Kafka", "Airflow", "dbt", "Looker", "Qlik", "Alteryx", "SSIS", "SSRS",
          "Informatica", "Anaplan", "Salesforce", "SAP", "Oracle", "Workday", "ServiceNow", "Dynamics 365", "SharePoint",
          "Power Apps", "Power Automate", "Java", "JavaScript", "TypeScript", "React", "Angular", "Vue", "Node.js", ".NET",
          "C#", "C++", "Go", "Rust", "PHP", "Ruby", "Swift", "Kotlin", "Flutter", "Docker", "Kubernetes", "Terraform",
          "Linux", "Git", "Jenkins", "Selenium", "Machine Learning", "Deep Learning", "NLP", "Computer Vision",
          "Generative AI", "LLM", "TensorFlow", "PyTorch", "Pandas", "Statistics", "Data Modeling", "ETL", "Data Warehousing",
          "Agile", "Scrum", "Jira", "Figma", "Adobe Photoshop", "Adobe Illustrator", "SEO", "Google Analytics", "HubSpot",
          "Shopify", "QuickBooks", "Bookkeeping", "Six Sigma", "PMP", "Lean", "AutoCAD", "SolidWorks", "Cybersecurity",
          "Penetration Testing", "Networking", "Customer Service", "Bilingual Spanish", "Bilingual"]

COMPANIES = ["Google", "Microsoft", "Amazon", "Apple", "Meta", "Netflix", "Nvidia", "Tesla", "IBM", "Oracle", "Salesforce",
             "Adobe", "Intel", "Cisco", "Dell", "HP", "Accenture", "Deloitte", "PwC", "EY", "KPMG", "McKinsey", "Boston Consulting Group",
             "Bain", "Capgemini", "Cognizant", "Infosys", "TCS", "Tata Consultancy Services", "Wipro", "HCLTech", "Tech Mahindra",
             "JPMorgan Chase", "Goldman Sachs", "Morgan Stanley", "Bank of America", "Citi", "Wells Fargo", "Capital One",
             "American Express", "Visa", "Mastercard", "PayPal", "Stripe", "Fidelity", "Charles Schwab", "BlackRock",
             "UnitedHealth Group", "CVS Health", "Walgreens", "Pfizer", "Johnson & Johnson", "Merck", "AbbVie", "Kaiser Permanente",
             "Walmart", "Target", "Costco", "Home Depot", "Lowe's", "Best Buy", "Kroger", "Starbucks", "McDonald's", "Nike",
             "Coca-Cola", "PepsiCo", "Procter & Gamble", "Unilever", "Disney", "Comcast", "Verizon", "AT&T", "T-Mobile",
             "FedEx", "UPS", "DHL", "Boeing", "Lockheed Martin", "General Electric", "General Motors", "Ford", "Toyota",
             "Uber", "Lyft", "Airbnb", "DoorDash", "Instacart", "Spotify", "LinkedIn", "Indeed", "Shopify", "Snowflake",
             "Databricks", "OpenAI", "Anthropic", "Palantir", "ServiceNow", "Workday", "Intuit", "SAP", "Siemens",
             "Samsung", "Sony", "Infor", "Anaplan", "Peak Stream Technologies"]


def build():
    titles = []
    seen = set()

    def add(t):
        k = t.lower()
        if k not in seen:
            seen.add(k)
            titles.append(t)

    for t in PLAIN:
        add(t.strip())
    for tech, roles in TECH.items():
        for r in roles:
            base = f"{tech} {r}"
            add(base)
            if r.endswith(SENIOR_OK):
                add(f"Senior {base}")
                if r.endswith(("Developer", "Engineer", "Analyst", "Architect", "Consultant", "Scientist", "Designer")):
                    add(f"Lead {base}")
                    add(f"Junior {base}")
    skills = [s for s in dict.fromkeys(SKILLS)]
    companies = [c for c in dict.fromkeys(COMPANIES)]
    return titles, skills, companies


if __name__ == "__main__":
    titles, skills, companies = build()
    js = ("// Suggestions for the job title box. Generated list; edit gen_titles.py or add entries here.\n"
          "window.JOB_SUGGESTIONS = " + json.dumps({"titles": titles, "skills": skills, "companies": companies},
                                                     ensure_ascii=False, separators=(",", ":")) + ";\n")
    open(sys.argv[1], "w", encoding="utf-8").write(js)
    print(len(titles), "titles,", len(skills), "skills,", len(companies), "companies,", len(js.encode()), "bytes")
    print([t for t in titles if t.lower().startswith("power bi")][:40])
