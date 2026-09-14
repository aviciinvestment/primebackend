import re
import json

raw_text = """CATEGORY 1 — FINAL-YEAR / UNDERGRADUATE OPPORTUNITIES
Nigerian / African Corporate & Industrial Opportunities
1. Shell Nigeria Student Industrial Training and Internship Programme (SIWES)
Type: Internship / SIWES
Field: Engineering, Geosciences, IT, Sciences, Social Sciences, Commercial
Location: Nigeria
Eligibility: Nigerian undergraduate students
Deadline: Not specified
Status: OPEN / Check portal
Direct link: [https://www.shell.com.ng/careers/students-and-graduates/student-industrial-training-and-internship-program.html](https://www.shell.com.ng/careers/students-and-graduates/student-industrial-training-and-internship-program.html)
2. Shell Nigeria Students and Graduates Opportunities
Type: Internship / Graduate opportunities
Field: Engineering, Technology, Commercial, Science, Geosciences
Location: Nigeria / Global
Eligibility: Students and graduates
Deadline: Vacancy-specific
Status: OPEN / Vacancy-specific
Direct link: [https://www.shell.com.ng/careers/students-and-graduates.html](https://www.shell.com.ng/careers/students-and-graduates.html)
3. NCDMB/Shell/PETAN Internship Programme
Type: Internship / Technical training
Field: Engineering, Geology
Location: Nigeria
Eligibility: Nigerian technical/graduate talent
Deadline: Not specified
Status: Vacancy-specific
Direct link: [https://www.shell.com.ng/sustainability/communities.html](https://www.shell.com.ng/sustainability/communities.html)
4. Nestlé Global Internships
Type: Internship
Field: Engineering, IT, Finance, Supply Chain, Marketing, R&D, Nutrition, Food Science
Location: Global
Eligibility: Students / recent graduates depending on vacancy
Deadline: Vacancy-specific
Status: OPEN / Vacancy-specific
Direct link: [https://www.nestle.com/jobs/career-area/internships](https://www.nestle.com/jobs/career-area/internships)
5. Nesternships — Nestlé
Type: Internship
Field: Digital, Business, Marketing and other disciplines
Location: Africa, Middle East, Asia and other regions
Eligibility: Students / young talent
Deadline: Programme-specific
Status: Vacancy-specific
Direct link: [https://www.nestle.com/jobs/students-graduates](https://www.nestle.com/jobs/students-graduates)
6. Nestlé Internship / University Jobs
Type: Internship
Field: Multiple disciplines
Location: Global
Eligibility: Students and recent graduates
Deadline: Vacancy-specific
Status: OPEN / Vacancy-specific
Direct link: [https://www.nestle.com/jobs/search-jobs?career_area=All&company=All&keyword=internship&location=](https://www.nestle.com/jobs/search-jobs?career_area=All&company=All&keyword=internship&location=)
7. Goldman Sachs 2027 Summer Analyst Programme — EMEA
Type: Internship
Field: Finance, Engineering, Technology, Operations, Risk, Investment Banking
Location: Europe, Middle East & Africa
Eligibility: Penultimate/final-year Bachelor's/Master's students
Deadline: Rolling
Status: OPEN
Direct link: [https://www.goldmansachs.com/careers/students/programs-and-internships/emea/summer-analyst-programme](https://www.goldmansachs.com/careers/students/programs-and-internships/emea/summer-analyst-programme)
8. Goldman Sachs 2027 New Analyst Programme — EMEA
Type: Full-time Analyst / Graduate programme
Field: Finance, Engineering, Technology, Operations, Risk, Investment Banking
Location: EMEA
Eligibility: Final-year undergraduate / graduate students
Deadline: Division-specific
Status: OPEN / Vacancy-specific
Direct link: [https://www.goldmansachs.com/careers/students/programs-and-internships/emea/new-analyst-programme](https://www.goldmansachs.com/careers/students/programs-and-internships/emea/new-analyst-programme)
9. Goldman Sachs 2027 Summer Analyst Programme — Americas
Type: Internship
Field: Finance, Engineering, Technology, Business
Location: Americas
Eligibility: Undergraduate / graduate students meeting graduation-window requirements
Deadline: Vacancy-specific
Status: Vacancy-specific
Direct link: [https://www.goldmansachs.com/careers/students/programs-and-internships/americas/2027-summer-analyst-program](https://www.goldmansachs.com/careers/students/programs-and-internships/americas/2027-summer-analyst-program)
10. Goldman Sachs 2027 New Analyst Programme — Asia Pacific
Type: Graduate / Analyst programme
Field: Finance, Technology, Engineering, Business
Location: Asia Pacific
Eligibility: Final-year undergraduate / graduate students
Deadline: Vacancy-specific
Status: Vacancy-specific
Direct link: [https://www.goldmansachs.com/careers/students/programs-and-internships/asia-pacific/new-analyst](https://www.goldmansachs.com/careers/students/programs-and-internships/asia-pacific/new-analyst)
11. Amazon Software Development Engineer Internship
Type: Internship
Field: Computer Science, Computer Engineering, Software Engineering, Data Science
Location: United States / vacancy-specific
Eligibility: Current Bachelor's students with qualifying graduation dates
Deadline: Vacancy-specific
Status: Vacancy-specific
Direct link: [https://www.amazon.jobs/en/jobs/3116030/software-development-engineer-internship-summer-2026-us](https://www.amazon.jobs/en/jobs/3116030/software-development-engineer-internship-summer-2026-us)
12. Amazon Software Development Engineer — Embedded Development Internship
Type: Internship
Field: Computer Engineering, Embedded Systems, Computer Science, Data Science
Location: Vacancy-specific
Eligibility: Students meeting vacancy requirements
Deadline: Vacancy-specific
Status: Vacancy-specific
Direct link: [https://amazon.jobs/en/jobs/3134271/software-dev-engineer-internship-embedded-development](https://amazon.jobs/en/jobs/3134271/software-dev-engineer-internship-embedded-development)
13. Amazon Robotics Software Development Engineer Internship
Type: Internship
Field: Robotics, Computer Engineering, Computer Science, AI/ML
Location: Vacancy-specific
Eligibility: Students meeting vacancy requirements
Deadline: Vacancy-specific
Status: Vacancy-specific
Direct link: [https://amazon.jobs/en-gb/jobs/3136266/robotics-software-development-engineer-intern-co-op-2026](https://amazon.jobs/en-gb/jobs/3136266/robotics-software-development-engineer-intern-co-op-2026)
14. Amazon Student Software Development Engineer Opportunities
Type: Internship / Student programme
Field: Software Engineering, AI, Computer Vision, Distributed Systems
Location: Global / vacancy-specific
Eligibility: Students and graduates
Deadline: Vacancy-specific
Status: OPEN / Vacancy-specific
Direct link: [https://www.amazon.jobs/content/en/career-programs/university/sde](https://www.amazon.jobs/content/en/career-programs/university/sde)
15. JPMorganChase Software Engineer Internship
Type: Internship
Field: Software Engineering, Computer Science, Technology
Location: Global / vacancy-specific
Eligibility: Students
Deadline: Vacancy-specific
Status: Vacancy-specific
Direct link: [https://careers.jpmorgan.com/us/en/students/programs/software-engineer-summer](https://careers.jpmorgan.com/us/en/students/programs/software-engineer-summer)
16. Morgan Stanley Students & Graduates Internship Programmes
Type: Internship / Student programme
Field: Finance, Technology, Engineering, Operations, Research
Location: Global / vacancy-specific
Eligibility: Students
Deadline: Vacancy-specific
Status: Vacancy-specific
Direct link: [https://www.morganstanley.com/careers/career-opportunities-search](https://www.morganstanley.com/careers/career-opportunities-search)
17. BlackRock 2027 Summer Internship Programme — EMEA
Type: Internship
Field: Technology, Investments, Operations, Finance, Client/Product, Corporate
Location: EMEA
Eligibility: Current students meeting graduation requirements
Deadline: Vacancy-specific
Status: OPEN / Vacancy-specific
Direct link: [https://careers.blackrock.com/search-jobs?k=Summer+internship+opportunities](https://careers.blackrock.com/search-jobs?k=Summer+internship+opportunities)
18. BlackRock 2027 Summer Internship — Technology
Type: Internship
Field: Software Engineering, Data, Technology
Location: Americas / vacancy-specific
Eligibility: Students
Deadline: Vacancy-specific
Status: Vacancy-specific
Direct link: [https://careers.blackrock.com/students-and-graduates-americas](https://careers.blackrock.com/students-and-graduates-americas)
19. NVIDIA University Internships
Type: Internship
Field: AI/ML, Computer Engineering, Electrical Engineering, Software, Hardware, Robotics, Graphics
Location: Global
Eligibility: BS/MS/PhD students depending on role
Deadline: Vacancy-specific / rolling
Status: OPEN / Vacancy-specific
Direct link: [https://www.nvidia.com/en-us/about-nvidia/careers/university-recruiting/](https://www.nvidia.com/en-us/about-nvidia/careers/university-recruiting/)
20. Atlassian Student Internship Programme
Type: Internship
Field: Software Engineering, Product, Design, Data
Location: Global / vacancy-specific
Eligibility: Primarily penultimate-year students
Deadline: Vacancy-specific
Status: Vacancy-specific
Direct link: [https://www.atlassian.com/company/careers/earlycareers](https://www.atlassian.com/company/careers/earlycareers)
21. Deloitte Global Student Internships
Type: Internship
Field: Consulting, Technology, Risk, Audit, Financial Advisory, Tax
Location: Global
Eligibility: Students
Deadline: Vacancy-specific
Status: Vacancy-specific
Direct link: [https://www.deloitte.com/global/en/careers/job-search.html](https://www.deloitte.com/global/en/careers/job-search.html)
22. Deloitte Southeast Asia Intern Experience
Type: Internship
Field: Consulting, Technology, Audit, Risk, Business
Location: Southeast Asia
Eligibility: Undergraduate students
Deadline: Programme-specific
Status: Programme-specific
Direct link: [https://www.deloitte.com/southeast-asia/en/careers/explore-your-fit/students/sea-intern-experience.html](https://www.deloitte.com/southeast-asia/en/careers/explore-your-fit/students/sea-intern-experience.html)
23. KPMG International Student Internship Opportunities
Type: Internship
Field: Audit, Advisory, Tax, Consulting, Technology
Location: Global / country-specific
Eligibility: Students; individual vacancies determine final-year eligibility
Deadline: Vacancy-specific
Status: Vacancy-specific
Direct link: [https://kpmg.com/ng/en/careers.html](https://kpmg.com/ng/en/careers.html)
24. PwC Nigeria Student / Graduate Careers
Type: Internship / Student programme
Field: Audit, Tax, Consulting, Technology, Deals, Risk
Location: Nigeria
Eligibility: Students / graduates depending on role
Deadline: Vacancy-specific
Status: Vacancy-specific
Direct link: [https://www.pwc.com/ng/en/careers.html](https://www.pwc.com/ng/en/careers.html)
25. PwC Africa Student & Graduate Opportunities
Type: Internship / Graduate programme
Field: Audit, Consulting, Deals, Tax, Technology, Risk
Location: Africa
Eligibility: Students / graduates
Deadline: Vacancy-specific
Status: Vacancy-specific
Direct link: [https://www.pwc.com/na/en/careers/regional-job-search.html](https://www.pwc.com/na/en/careers/regional-job-search.html)
INTERNATIONAL SCHOLARSHIPS ACCEPTING FINAL-YEAR APPLICANTS
26. Commonwealth Master's Scholarships
Type: Fully funded Master's scholarship
Field: Development-related Master's programmes
Location: United Kingdom
Eligibility: Commonwealth citizens including Nigerians; final-year Bachelor's students can apply subject to requirements
Deadline: 20 October 2026
Status: OPEN
Direct link: [https://cscuk.fcdo.gov.uk/scholarships/commonwealth-masters-scholarships/](https://cscuk.fcdo.gov.uk/scholarships/commonwealth-masters-scholarships/)
27. Commonwealth Shared Scholarships
Type: Fully funded Master's scholarship
Field: Development-related disciplines
Location: United Kingdom
Eligibility: Eligible Commonwealth citizens
Deadline: Programme-specific
Status: Cycle-specific
Direct link: [https://cscuk.fcdo.gov.uk/scholarships/commonwealth-shared-scholarships/](https://cscuk.fcdo.gov.uk/scholarships/commonwealth-shared-scholarships/)
28. Commonwealth Distance Learning Scholarships
Type: Scholarship
Field: Development-related Master's study
Location: UK / Online
Eligibility: Eligible Commonwealth countries
Deadline: Programme-specific
Status: Cycle-specific
Direct link: [https://cscuk.fcdo.gov.uk/scholarships/commonwealth-distance-learning-scholarships/](https://cscuk.fcdo.gov.uk/scholarships/commonwealth-distance-learning-scholarships/)
29. Commonwealth Equality Network Scholarships
Type: Master's / PhD scholarship
Field: Development, human rights and related disciplines
Location: United Kingdom
Eligibility: Specific Equality Network eligibility requirements
Deadline: 20 October 2026
Status: OPEN
Direct link: [https://cscuk.fcdo.gov.uk/scholarships/](https://cscuk.fcdo.gov.uk/scholarships/)
30. Rhodes Scholarship — West Africa Constituency
Type: Fully funded postgraduate scholarship
Field: Multiple postgraduate fields
Location: University of Oxford, UK
Eligibility: Eligible West African applicants; final-year students may apply subject to rules
Deadline: 27 August 2026
Status: CLOSED for 2027 cycle
Direct link: [https://www.rhodeshouse.ox.ac.uk/scholarships/apply/](https://www.rhodeshouse.ox.ac.uk/scholarships/apply/)
31. Rhodes Scholarship — Global
Type: Fully funded postgraduate scholarship
Field: Multiple disciplines
Location: University of Oxford, UK
Eligibility: Eligible nationalities/constituencies
Deadline: Constituency-specific
Status: Cycle-specific
Direct link: [https://www.rhodeshouse.ox.ac.uk/scholarships/](https://www.rhodeshouse.ox.ac.uk/scholarships/)
32. Gates Cambridge Scholarship
Type: Fully funded Master's / PhD scholarship
Field: Most academic fields
Location: University of Cambridge, UK
Eligibility: International applicants
Deadline: 14 October 2026 / 8 December 2026 / 6 January 2027 depending on course
Status: OPEN / Upcoming deadlines
Direct link: [https://www.postgraduate.study.cam.ac.uk/funding](https://www.postgraduate.study.cam.ac.uk/funding)
33. Cambridge Trust Scholarships
Type: Scholarship
Field: Master's and PhD — multiple fields
Location: UK
Eligibility: International students
Deadline: Course-specific
Status: OPEN / Upcoming
Direct link: [https://www.postgraduate.study.cam.ac.uk/funding](https://www.postgraduate.study.cam.ac.uk/funding)
34. Cambridge International Scholarships
Type: PhD scholarship
Field: Research disciplines
Location: UK
Eligibility: International students
Deadline: Course-specific
Status: Upcoming
Direct link: [https://www.postgraduate.study.cam.ac.uk/funding](https://www.postgraduate.study.cam.ac.uk/funding)
35. Cambridge Vice-Chancellor's Awards
Type: Postgraduate scholarship
Field: Selected postgraduate disciplines
Location: UK
Eligibility: International students
Deadline: Course-specific
Status: Upcoming
Direct link: [https://www.postgraduate.study.cam.ac.uk/funding](https://www.postgraduate.study.cam.ac.uk/funding)
36. Cambridge Harding Distinguished Postgraduate Scholars Programme
Type: Postgraduate research scholarship
Field: Research disciplines
Location: UK
Eligibility: International applicants
Deadline: Course-specific
Status: Upcoming
Direct link: [https://www.postgraduate.study.cam.ac.uk/funding](https://www.postgraduate.study.cam.ac.uk/funding)
37. Erasmus Mundus Joint Masters Scholarships
Type: Fully funded Master's scholarship
Field: Engineering, AI, Data Science, Environmental Science, Health, Economics and many others
Location: Europe / multiple countries
Eligibility: Bachelor's graduates / final-year applicants where programme permits
Deadline: Programme-specific, generally October–January
Status: Upcoming / programme-specific
Direct link: [https://erasmus-plus.ec.europa.eu/projects/search/](https://erasmus-plus.ec.europa.eu/projects/search/)
38. Mastercard Foundation Scholars Program — University of Cape Town
Type: Fully funded scholarship
Field: Undergraduate / postgraduate programmes
Location: South Africa
Eligibility: African students facing significant socioeconomic barriers
Deadline: 30 September 2026 undergraduate / 31 October 2026 postgraduate
Status: OPEN
Direct link: [https://www.uct.ac.za/mastercardfdn/apply-mastercard-foundation-scholars-program](https://www.uct.ac.za/mastercardfdn/apply-mastercard-foundation-scholars-program)
39. Mastercard Foundation Scholars Program — African Universities
Type: Scholarship
Field: Undergraduate and Master's programmes
Location: Africa
Eligibility: Eligible African students
Deadline: Institution/programme-specific
Status: Programme-specific
Direct link: [https://mastercardfdn.org/all/scholars/](https://mastercardfdn.org/all/scholars/)
40. ETH Zurich Excellence Scholarship & Opportunity Programme (ESOP)
Type: Scholarship
Field: Engineering, Computer Science, Natural Sciences, Architecture
Location: Switzerland
Eligibility: Master's applicants
Deadline: Programme-specific
Status: Upcoming / annual
Direct link: [https://ethz.ch/en/studies/financial/scholarships/excellencescholarship.html](https://ethz.ch/en/studies/financial/scholarships/excellencescholarship.html)
41. ETH Zurich Master Scholarship Programme
Type: Scholarship
Field: STEM and other Master's disciplines
Location: Switzerland
Eligibility: International Master's applicants
Deadline: Programme-specific
Status: Upcoming / annual
Direct link: [https://ethz.ch/en/studies/financial/scholarships.html](https://ethz.ch/en/studies/financial/scholarships.html)
42. TU Delft Justus & Louise van Effen Excellence Scholarships
Type: Scholarship
Field: Engineering, Technology, Architecture
Location: Netherlands
Eligibility: Master's applicants
Deadline: Programme-specific
Status: Annual / upcoming
Direct link: [https://www.tudelft.nl/en/education/practical-matters/scholarships/justus-louise-van-effen-excellence-scholarships](https://www.tudelft.nl/en/education/practical-matters/scholarships/justus-louise-van-effen-excellence-scholarships)
43. TU Delft Faculty Scholarships
Type: Scholarship
Field: Engineering, Aerospace, Computer Science, Robotics, Civil, Mechanical
Location: Netherlands
Eligibility: Master's applicants
Deadline: Programme-specific
Status: Annual / upcoming
Direct link: [https://www.tudelft.nl/en/education/practical-matters/scholarships](https://www.tudelft.nl/en/education/practical-matters/scholarships)
44. University of Amsterdam Amsterdam Merit Scholarship
Type: Master's scholarship
Field: Multiple academic fields
Location: Netherlands
Eligibility: Non-EU/EEA Master's applicants
Deadline: Programme-specific
Status: Annual
Direct link: [https://www.uva.nl/en/about-the-uva/organisation/faculties/amsterdam-law-school/education/scholarships/amsterdam-merit-scholarship.html](https://www.uva.nl/en/about-the-uva/organisation/faculties/amsterdam-law-school/education/scholarships/amsterdam-merit-scholarship.html)
45. Karolinska Institutet Global Master's Scholarship
Type: Master's scholarship
Field: Medicine, Public Health, Health Sciences
Location: Sweden
Eligibility: International Master's applicants
Deadline: Programme-specific
Status: Annual
Direct link: [https://education.ki.se/scholarships](https://education.ki.se/scholarships)
46. University College London Global Master's Scholarship
Type: Master's scholarship
Field: Multiple disciplines
Location: United Kingdom
Eligibility: International students from eligible backgrounds
Deadline: Annual / programme-specific
Status: Annual
Direct link: [https://www.ucl.ac.uk/scholarships/global-masters-scholarship](https://www.ucl.ac.uk/scholarships/global-masters-scholarship)
47. University of Edinburgh Global Scholarships
Type: Master's scholarship
Field: Multiple disciplines
Location: United Kingdom
Eligibility: International students
Deadline: Programme-specific
Status: Annual
Direct link: [https://www.ed.ac.uk/student-funding/postgraduate/international](https://www.ed.ac.uk/student-funding/postgraduate/international)
48. University of Bristol Think Big Scholarship
Type: Undergraduate / Master's scholarship
Field: Multiple disciplines
Location: United Kingdom
Eligibility: International students
Deadline: Programme-specific
Status: Annual
Direct link: [https://www.bristol.ac.uk/students/support/finances/scholarships/](https://www.bristol.ac.uk/students/support/finances/scholarships/)
49. University of Nottingham Developing Solutions Masters Scholarship
Type: Master's scholarship
Field: Development-related disciplines
Location: United Kingdom
Eligibility: Students from eligible developing countries
Deadline: Annual / programme-specific
Status: Annual
Direct link: [https://www.nottingham.ac.uk/studywithus/international/applying/scholarships/developing-solutions-masters-scholarship.aspx](https://www.nottingham.ac.uk/studywithus/international/applying/scholarships/developing-solutions-masters-scholarship.aspx)
50. University of Exeter Excellence Scholarships
Type: Scholarship
Field: Engineering, Computer Science, Science, Business and others
Location: United Kingdom
Eligibility: International undergraduate/postgraduate students
Deadline: Programme-specific
Status: Annual / cycle-specific
Direct link: [https://www.exeter.ac.uk/study/funding/exeterexcellence/](https://www.exeter.ac.uk/study/funding/exeterexcellence/)
51. University of Exeter Nigeria Postgraduate Taught Scholarship
Type: Master's scholarship
Field: Computer Science, Engineering, Mathematics, Physics, Finance, Management and others
Location: United Kingdom
Eligibility: Nigerian students with qualifying Master's offer
Deadline: 28 August 2026
Status: CLOSED for 2026/27
Direct link: [https://www.exeter.ac.uk/study/funding/award/?id=5677](https://www.exeter.ac.uk/study/funding/award/?id=5677)
52. Queen Mary University of London Global Excellence Scholarship
Type: Master's scholarship
Field: Multiple disciplines
Location: United Kingdom
Eligibility: International students with qualifying offer
Deadline: Programme/award-specific
Status: Check current availability
Direct link: [https://www.qmul.ac.uk/scholarships/items/global-excellence-scholarship-postgraduate-taught.html](https://www.qmul.ac.uk/scholarships/items/global-excellence-scholarship-postgraduate-taught.html)
53. Queen Mary University of London Global Talent Scholarship
Type: Master's scholarship
Field: Multiple disciplines
Location: United Kingdom
Eligibility: International students
Deadline: Programme/award-specific
Status: Check current availability
Direct link: [https://www.qmul.ac.uk/scholarships/items/global-talent-scholarship-postgraduate-taught.html](https://www.qmul.ac.uk/scholarships/items/global-talent-scholarship-postgraduate-taught.html)
54. University of Strathclyde International Excellence Scholarships
Type: Master's scholarship
Field: Engineering, Science, Business, Humanities, Social Sciences
Location: Scotland, UK
Eligibility: International students
Deadline: Programme-specific
Status: Programme-specific
Direct link: [https://www.strath.ac.uk/studywithus/postgraduatetaught/postgraduatescholarships/](https://www.strath.ac.uk/studywithus/postgraduatetaught/postgraduatescholarships/)
55. University of Auckland International Student Excellence Scholarship
Type: Undergraduate / Master's scholarship
Field: Multiple disciplines
Location: New Zealand
Eligibility: International students including Nigerians
Deadline: 21 October 2026
Status: OPEN
Direct link: [https://www.auckland.ac.nz/en/study/scholarships-and-awards/scholarships/international-student-excellence-scholarship.html](https://www.auckland.ac.nz/en/study/scholarships-and-awards/scholarships/international-student-excellence-scholarship.html)
CATEGORY 2 — GRADUATES / DEGREE HOLDERS
Nigerian Graduate Trainee & Corporate Programmes
56. Union Bank Management Trainee Programme 2026
Type: Graduate Trainee
Field: Banking, Finance, Technology, Business, Operations
Location: Nigeria
Eligibility: Graduates
Deadline: Not specified
Status: OPEN
Direct link: [https://www.unionbankng.com/careers/](https://www.unionbankng.com/careers/)
57. Union Bank Tech Bootcamp 2026
Type: Technology Bootcamp / Graduate programme
Field: Software Engineering, Data, Technology, Digital Banking
Location: Nigeria
Eligibility: Young technology talent / graduates
Deadline: Not specified
Status: OPEN
Direct link: [https://www.unionbankng.com/careers/](https://www.unionbankng.com/careers/)
58. Heirs Holdings Graduate Trainee Programme
Type: Graduate Trainee
Field: Business, Finance, Technology, Engineering, Operations
Location: Nigeria
Eligibility: Bachelor's degree, 2:2+, completed NYSC, limited post-NYSC experience
Deadline: 4 September 2026
Status: CLOSED
Direct link: [https://graduate-trainee.heirsholdings.com/](https://graduate-trainee.heirsholdings.com/)
59. LIFEPAGE Graduate Trainee Programme 2026/27
Type: Graduate Trainee
Field: Any discipline; commercial, real estate, business
Location: Lagos, Nigeria
Eligibility: Degree holders, no more than 2 years after graduation; NYSC completed/exempted or completing before programme
Deadline: 14 September 2026
Status: OPEN — URGENT
Direct link: [https://graduatetrainee.lifepage.ng/](https://graduatetrainee.lifepage.ng/)
60. KPMG Nigeria Graduate Trainee Programme 2027
Type: Graduate Trainee
Field: Audit, Tax, Advisory, Consulting, Technology
Location: Nigeria
Eligibility: University graduates
Deadline: Vacancy/programme-specific
Status: Check portal
Direct link: [https://apps.ng.kpmg.com/careers/recruitment/gt-program.html](https://apps.ng.kpmg.com/careers/recruitment/gt-program.html)
61. KPMG Nigeria Pre-NYSC Internship
Type: Internship / Pre-NYSC
Field: Consulting, Business, Technology and related areas
Location: Nigeria
Eligibility: Graduates awaiting NYSC deployment
Deadline: Vacancy-specific
Status: Check portal
Direct link: [https://apps.ng.kpmg.com/careers/team.html](https://apps.ng.kpmg.com/careers/team.html)
62. PwC Nigeria Graduate Recruitment
Type: Graduate Recruitment
Field: Audit, Tax, Consulting, Deals, Technology, Risk
Location: Nigeria
Eligibility: Graduates
Deadline: Vacancy-specific
Status: Vacancy-specific
Direct link: [https://www.pwc.com/ng/en/careers.html](https://www.pwc.com/ng/en/careers.html)
63. Deloitte Nigeria Graduate Programme — Audit & Assurance
Type: Graduate Programme
Field: Accounting, Finance, Economics
Location: Nigeria
Eligibility: Graduates + NYSC requirements
Deadline: 10 April 2026 for 2026 cycle
Status: CLOSED
Direct link: [https://www.deloitte.com/ng/en/careers/explore-your-fit/experienced/early-careers-programmes.html](https://www.deloitte.com/ng/en/careers/explore-your-fit/experienced/early-careers-programmes.html)
64. Deloitte Nigeria Graduate Programme — Consulting
Type: Graduate Programme
Field: Business, Economics, Engineering, Technology
Location: Nigeria
Eligibility: Graduates + NYSC
Deadline: 10 April 2026 for 2026 cycle
Status: CLOSED
Direct link: [https://www.deloitte.com/ng/en/careers/explore-your-fit/experienced/early-careers-programmes.html](https://www.deloitte.com/ng/en/careers/explore-your-fit/experienced/early-careers-programmes.html)
65. Deloitte Nigeria Graduate Programme — Tax & Legal
Type: Graduate Programme
Field: Law, Accounting, Finance, Economics
Location: Nigeria
Eligibility: Graduates + NYSC
Deadline: 10 April 2026 for 2026 cycle
Status: CLOSED
Direct link: [https://www.deloitte.com/ng/en/careers/explore-your-fit/experienced/early-careers-programmes.html](https://www.deloitte.com/ng/en/careers/explore-your-fit/experienced/early-careers-programmes.html)
66. Deloitte Nigeria Graduate Programme — Financial Advisory
Type: Graduate Programme
Field: Finance, Economics, Accounting, Business
Location: Nigeria
Eligibility: Graduates
Deadline: Vacancy-specific
Status: Check portal
Direct link: [https://www.deloitte.com/ng/en/careers/](https://www.deloitte.com/ng/en/careers/)
67. Deloitte Nigeria Graduate Programme — Risk Advisory
Type: Graduate Programme
Field: Technology, Cybersecurity, Risk, Finance
Location: Nigeria
Eligibility: Graduates
Deadline: Vacancy-specific
Status: Check portal
Direct link: [https://www.deloitte.com/ng/en/careers/](https://www.deloitte.com/ng/en/careers/)
68. FirstBank Nigeria Pan-African Graduate Trainee Programme
Type: Graduate Trainee
Field: Banking, Finance, Business, Economics, Technology
Location: Nigeria / Africa
Eligibility: Graduates
Deadline: Vacancy-specific
Status: Check portal
Direct link: [https://www.firstbanknigeria.com/careers/](https://www.firstbanknigeria.com/careers/)
69. Seplat Energy Technical Graduate Trainee Programme
Type: Graduate Trainee
Field: Engineering, Geosciences, Technical disciplines
Location: Nigeria
Eligibility: Technical graduates
Deadline: 13 May 2026
Status: CLOSED
Direct link: [https://www.seplatenergy.com/careers/](https://www.seplatenergy.com/careers/)
70. Oilserv Ingenious Graduate Trainee Programme
Type: Graduate Trainee
Field: Engineering, Law, Information Management, Accounting, ESG, Social Sciences
Location: Nigeria
Eligibility: Graduates; NYSC completed; 2:1; 0–2 years experience
Deadline: Previous 2026 cycle
Status: CLOSED / Watch next cycle
Direct link: [https://oilservltd-ng.com/careers/vacancies/2024-graduate-training-program/](https://oilservltd-ng.com/careers/vacancies/2024-graduate-training-program/)
71. Dangote Petroleum Refinery Graduate Trainee Programme
Type: Graduate Trainee
Field: Chemical, Production, Mining, Mechanical, Electrical, Instrumentation, Power Engineering, IT, Finance, Accounting
Location: Nigeria
Eligibility: Graduates
Deadline: Vacancy-specific
Status: Check portal
Direct link: [https://dangote.com/careers/](https://dangote.com/careers/)
72. Dangote Industries Graduate Trainee Programme
Type: Graduate Trainee
Field: Engineering, Manufacturing, Finance, IT, Supply Chain, HR
Location: Nigeria
Eligibility: Graduates
Deadline: Vacancy-specific
Status: Check portal
Direct link: [https://dangote.com/careers/](https://dangote.com/careers/)
73. CFAO Motors Nigeria Graduate Trainee Programme
Type: Graduate Trainee
Field: Automotive, Engineering, Sales, Operations, Business
Location: Nigeria
Eligibility: Graduates
Deadline: Vacancy-specific
Status: Check portal
Direct link: [https://www.cfaomotors.com/careers/](https://www.cfaomotors.com/careers/)
74. A.G. Leventis Nigeria Graduate Trainee Programme
Type: Graduate Trainee
Field: Fleet Management, Logistics, Supply Chain, Operations
Location: Nigeria
Eligibility: Graduates
Deadline: Vacancy-specific
Status: Check portal
Direct link: [https://agleventis.com/careers/](https://agleventis.com/careers/)
75. Greenville LNG Graduate Engineering Trainee Programme
Type: Graduate Trainee
Field: Chemical, Gas, Production, Mechanical, Electrical, Mechatronics, Instrumentation Engineering
Location: Nigeria
Eligibility: Engineering graduates
Deadline: Vacancy-specific
Status: Check portal
Direct link: [https://www.greenvilleng.com/careers/](https://www.greenvilleng.com/careers/)
76. Nestlé Management Trainee Programme — Africa
Type: Management Trainee
Field: Business, Marketing, Sales, Supply Chain, Finance
Location: Africa / programme-specific
Eligibility: Graduates / young professionals
Deadline: Vacancy-specific
Status: Programme-specific
Direct link: [https://www.nestle.com/jobs/students-graduates](https://www.nestle.com/jobs/students-graduates)
77. Nestlé Graduate Trainee Programme
Type: Graduate Trainee
Field: IT, Marketing, Sales, HR, Supply Chain, Finance, Nutrition, Digital Manufacturing
Location: Global
Eligibility: Graduates
Deadline: Vacancy-specific
Status: Vacancy-specific
Direct link: [https://www.nestle.com/jobs](https://www.nestle.com/jobs)
78. AB InBev Graduate Management Trainee Programme — Nigeria
Type: Management Trainee
Field: Sales, Supply Chain, Operations, Commercial
Location: Nigeria
Eligibility: Graduates
Deadline: Vacancy-specific
Status: Programme-specific
Direct link: [https://www.ab-inbev.com/careers/](https://www.ab-inbev.com/careers/)
79. Coca-Cola HBC Management Trainee Programme
Type: Management Trainee
Field: Commercial, Supply Chain, Operations
Location: Programme-specific
Eligibility: Graduates / young professionals
Deadline: Vacancy-specific
Status: Programme-specific
Direct link: [https://gr.indeed.com/cmp/Coca--Cola-Hellenic-Bottling-Company/career](https://gr.indeed.com/cmp/Coca--Cola-Hellenic-Bottling-Company/career)
80. Ardova Graduate Trainee Programme
Type: Graduate Trainee
Field: Energy, Operations, Commercial, Business
Location: Nigeria
Eligibility: Graduates
Deadline: Vacancy-specific
Status: Check portal
Direct link: [https://ardovaplc.com/careers/](https://ardovaplc.com/careers/)
81. Lush Hair Graduate Trainee Programme
Type: Graduate Trainee
Field: Sales, FMCG, Commercial, Business Development
Location: Nigeria
Eligibility: Graduates + NYSC
Deadline: Vacancy-specific
Status: Check portal
Direct link: [https://lushhair.com/careers/](https://lushhair.com/careers/)
82. ipNX Graduate Trainee Programme
Type: Graduate Trainee
Field: Telecommunications, ICT, Network Engineering, Technology
Location: Nigeria
Eligibility: Graduates
Deadline: Vacancy-specific
Status: Check portal
Direct link: [https://www.ipnxnigeria.net/careers/](https://www.ipnxnigeria.net/careers/)
83. TGI Group Young Professionals Programme
Type: Young Professionals / Graduate Programme
Field: Manufacturing, Agriculture, Engineering, Supply Chain, Finance
Location: Nigeria / Africa
Eligibility: Graduates / young professionals
Deadline: Vacancy-specific
Status: Check portal
Direct link: [https://www.tgigroup.com/careers/](https://www.tgigroup.com/careers/)
84. Saro Agrosciences Graduate Trainee Programme
Type: Graduate Trainee
Field: Agriculture, Agribusiness, Engineering, Science, Sales, Operations
Location: Nigeria
Eligibility: Graduates
Deadline: Vacancy-specific
Status: Check portal
Direct link: [https://saroafrica.com/careers/](https://saroafrica.com/careers/)
85. Digital Jewels Africa Graduate Trainee Programme
Type: Graduate Trainee
Field: Cybersecurity, Technology, Digital Transformation, Business, Consulting
Location: Nigeria
Eligibility: Graduates
Deadline: Vacancy-specific
Status: Check portal
Direct link: [https://digitaljewels.net/careers/](https://digitaljewels.net/careers/)
86. Arnergy Graduate Trainee Programme
Type: Graduate Trainee
Field: Renewable Energy, Engineering, Technology, Operations, Business
Location: Nigeria
Eligibility: Graduates
Deadline: Vacancy-specific
Status: Check portal
Direct link: [https://www.arnergy.com/careers/](https://www.arnergy.com/careers/)
87. PowerPro Engineering Graduate Trainee Programme
Type: Graduate Trainee
Field: Electrical, Mechanical, Power Engineering
Location: Nigeria
Eligibility: Engineering graduates
Deadline: Vacancy-specific
Status: Check portal
Direct link: [https://powerpro.com.ng/careers/](https://powerpro.com.ng/careers/)
88. HCP Graduate Management Trainee Programme
Type: Graduate Trainee
Field: Business, Finance, Consulting
Location: Nigeria
Eligibility: Graduates
Deadline: Vacancy-specific
Status: Check portal
Direct link: [https://hcp.com.ng/careers/](https://hcp.com.ng/careers/)
89. SIAT Group Graduate Trainee Programme
Type: Graduate Trainee
Field: Agriculture, Engineering, Agribusiness, Operations
Location: Africa / Nigeria
Eligibility: Graduates
Deadline: Vacancy-specific
Status: Check portal
Direct link: [https://siatgroup.com/careers/](https://siatgroup.com/careers/)
90. CardinalStone Graduate Trainee Programme
Type: Graduate Trainee
Field: Investment Banking, Asset Management, Research, Finance, Capital Markets
Location: Nigeria
Eligibility: Graduates
Deadline: Vacancy-specific
Status: Check portal
Direct link: [https://cardinalstone.com/careers/](https://cardinalstone.com/careers/)
91. VFD Group Graduate Trainee Programme
Type: Graduate Trainee
Field: Banking, Finance, Investment, Technology, Business
Location: Nigeria
Eligibility: Graduates
Deadline: Vacancy-specific
Status: Check portal
Direct link: [https://vfdgroup.com/careers/](https://vfdgroup.com/careers/)
92. Wema Bank Bankers-in-Training Programme
Type: Graduate Trainee
Field: Banking, Finance, Economics, Technology
Location: Nigeria
Eligibility: Graduates
Deadline: Vacancy-specific
Status: Check portal
Direct link: [https://www.wemabank.com/careers/](https://www.wemabank.com/careers/)
93. Sterling Bank Graduate Trainee Programme
Type: Graduate Trainee
Field: Banking, Finance, Technology, Business, Operations
Location: Nigeria
Eligibility: Graduates
Deadline: Vacancy-specific
Status: Check portal
Direct link: [https://sterling.ng/careers/](https://sterling.ng/careers/)
94. Access Bank Entry-Level / Graduate Programme
Type: Graduate Programme
Field: Banking, Technology, Finance, Business, Operations
Location: Nigeria
Eligibility: Graduates
Deadline: Vacancy-specific
Status: Check portal
Direct link: [https://www.accessbankplc.com/careers](https://www.accessbankplc.com/careers)
95. GTCO / Guaranty Trust Graduate Recruitment
Type: Graduate Recruitment
Field: Banking, Finance, Technology, Economics, Business
Location: Nigeria / Africa
Eligibility: Graduates
Deadline: Vacancy-specific
Status: Check portal
Direct link: [https://www.gtco.com/careers/](https://www.gtco.com/careers/)
96. Zenith Bank Graduate Trainee / Entry-Level Recruitment
Type: Graduate Recruitment
Field: Banking, Finance, Technology, Economics, Accounting, Business
Location: Nigeria
Eligibility: Graduates
Deadline: Vacancy-specific
Status: Check portal
Direct link: [https://www.zenithbank.com/careers/](https://www.zenithbank.com/careers/)
97. UBA Graduate Trainee Programme
Type: Graduate Trainee
Field: Banking, Finance, Economics, Technology, Business, Operations
Location: Nigeria / Africa
Eligibility: Graduates
Deadline: Vacancy-specific
Status: Check portal
Direct link: [https://www.ubagroup.com/careers/](https://www.ubagroup.com/careers/)
98. Stanbic IBTC Graduate Trainee Programme
Type: Graduate Trainee
Field: Banking, Finance, Technology, Investment, Risk, Business
Location: Nigeria
Eligibility: Graduates
Deadline: Vacancy-specific
Status: Check portal
Direct link: [https://www.stanbicibtcbank.com/nigeria/personal/about-us/careers](https://www.stanbicibtcbank.com/nigeria/personal/about-us/careers)
99. Fidelity Bank Graduate Trainee Programme
Type: Graduate Trainee
Field: Banking, Finance, Technology, Business, Operations
Location: Nigeria
Eligibility: Graduates
Deadline: Vacancy-specific
Status: Check portal
Direct link: [https://www.fidelitybank.ng/careers/](https://www.fidelitybank.ng/careers/)
100. FCMB Graduate Trainee Programme
Type: Graduate Trainee
Field: Banking, Finance, Technology, Business, Operations
Location: Nigeria
Eligibility: Graduates
Deadline: Vacancy-specific
Status: Check portal
Direct link: [https://www.fcmb.com/careers](https://www.fcmb.com/careers)
101. Polaris Bank Graduate Trainee Programme
Type: Graduate Trainee
Field: Banking, Finance, Technology, Business
Location: Nigeria
Eligibility: Graduates
Deadline: Vacancy-specific
Status: Check portal
Direct link: [https://www.polarisbanklimited.com/careers](https://www.polarisbanklimited.com/careers)
102. Ecobank Graduate Development Programme
Type: Graduate Programme
Field: Banking, Finance, Technology, Risk, Operations, Business
Location: Africa
Eligibility: Graduates / young professionals
Deadline: Vacancy-specific
Status: Check portal
Direct link: [https://www.ecobank.com/careers](https://www.ecobank.com/careers)
GRADUATE-ONLY INTERNATIONAL SCHOLARSHIPS & MULTILATERAL PROGRAMMES
103. Chevening Scholarships
Type: Fully funded Master's scholarship
Field: Broad range of eligible disciplines
Location: United Kingdom
Eligibility: Graduates with qualifying post-degree work experience
Deadline: 6 October 2026
Status: OPEN
Direct link: [https://www.chevening.org/scholarships/](https://www.chevening.org/scholarships/)
104. NNPC/SNEPCo Postgraduate Scholarship
Type: Postgraduate scholarship
Field: Oil & Gas Engineering, Geophysics, Data Science/AI, Robotics/AI, Safety & Reliability, Chemical Engineering and related fields
Location: United Kingdom
Eligibility: Nigerian graduates; NYSC completion required for 2026 cycle
Deadline: 8 June 2026
Status: CLOSED
Direct link: [https://www.shell.com.ng/sustainability/communities/education-programmes/scholarships.html](https://www.shell.com.ng/sustainability/communities/education-programmes/scholarships.html)
105. DAAD EPOS — Development-Related Postgraduate Courses
Type: Fully funded postgraduate scholarship
Field: Development, Engineering, Public Health, Economics, Environmental Science, Agriculture and related fields
Location: Germany
Eligibility: Graduates; relevant professional experience generally required
Deadline: Course-specific
Status: Programme-specific / upcoming cycles
Direct link: [https://www.daad.de/en/information-services-for-higher-education-institutions/further-information-on-daad-programmes/epos/](https://www.daad.de/en/information-services-for-higher-education-institutions/further-information-on-daad-programmes/epos/)
106. Joint Japan/World Bank Graduate Scholarship Programme (JJ/WBGSP)
Type: Fully funded Master's scholarship
Field: Development-related disciplines
Location: Participating universities worldwide
Eligibility: Graduates meeting degree-age and professional-experience requirements
Deadline: 2027 windows — 18–26 February and 29 March–21 May 2027
Status: UPCOMING
Direct link: [https://www.worldbank.org/en/programs/scholarships/jj-wbgsp](https://www.worldbank.org/en/programs/scholarships/jj-wbgsp)
107. Swedish Institute Scholarship for Global Professionals (SISGP)
Type: Fully funded Master's scholarship
Field: Multiple eligible Master's fields
Location: Sweden
Eligibility: Graduates/professionals from eligible countries
Deadline: Annual / programme-specific
Status: UPCOMING
Direct link: [https://si.se/en/apply/scholarships/swedish-institute-scholarships-for-global-professionals/](https://si.se/en/apply/scholarships/swedish-institute-scholarships-for-global-professionals/)
108. MEXT Research Students Scholarship
Type: Fully funded Master's / PhD / Research scholarship
Field: Engineering, Computer Science, Science, Humanities and others
Location: Japan
Eligibility: Graduates / degree holders
Deadline: Embassy/university-specific
Status: Annual
Direct link: [https://www.studyinjapan.go.jp/en/smap-stopj-applications/research-students/](https://www.studyinjapan.go.jp/en/smap-stopj-applications/research-students/)
109. Fulbright Foreign Student Program
Type: Master's / PhD scholarship
Field: Broad academic disciplines
Location: United States
Eligibility: International graduates
Deadline: Country-specific
Status: Annual / country-specific
Direct link: [https://foreign.fulbrightonline.org/](https://foreign.fulbrightonline.org/)
110. ARES Master's and Training Scholarships — Belgium
Type: Fully funded Master's / specialised training scholarship
Field: Development, Public Health, Engineering, Environment and related fields
Location: Belgium
Eligibility: Applicants from eligible developing countries
Deadline: Annual / programme-specific
Status: Upcoming / cycle-specific
Direct link: [https://www.ares-ac.be/en/cooperation-au-developpement/scholarships](https://www.ares-ac.be/en/cooperation-au-developpement/scholarships)"""

opportunities = []
current_category = ""
lines = raw_text.splitlines()

for i in range(len(lines)):
    line = lines[i].strip()
    if not line:
        continue
    
    # Check category
    if "CATEGORY 1" in line:
        current_category = "Final-Year Undergraduate"
        continue
    elif "CATEGORY 2" in line:
        current_category = "Graduate-Only"
        continue
        
    # Match title (e.g. "1. Shell Nigeria...")
    title_match = re.match(r'^\d+\.\s+(.*)', line)
    if title_match:
        # We found a new item
        opp = {
            "title": title_match.group(1).strip(),
            "category": current_category,
            "type": "",
            "field": "",
            "location": "",
            "eligibility": "",
            "deadline": "",
            "status": "",
            "directLink": "",
        }
        
        # Read the next lines until we hit another number or end
        j = i + 1
        while j < len(lines) and not re.match(r'^\d+\.\s+', lines[j].strip()) and not lines[j].startswith("CATEGORY"):
            if "Type:" in lines[j]:
                opp["type"] = lines[j].replace("Type:", "").strip()
            elif "Field:" in lines[j]:
                opp["field"] = lines[j].replace("Field:", "").strip()
            elif "Location:" in lines[j]:
                opp["location"] = lines[j].replace("Location:", "").strip()
            elif "Eligibility:" in lines[j]:
                opp["eligibility"] = lines[j].replace("Eligibility:", "").strip()
            elif "Deadline:" in lines[j]:
                opp["deadline"] = lines[j].replace("Deadline:", "").strip()
            elif "Status:" in lines[j]:
                opp["status"] = lines[j].replace("Status:", "").strip()
            elif "Direct link:" in lines[j]:
                link = lines[j].replace("Direct link:", "").strip()
                # Remove brackets and parentheses if formatted as markdown
                link = re.sub(r'^\[.*?\]\((.*?)\)$', r'\1', link)
                opp["directLink"] = link
            j += 1
            
        
        # Determine organization and other derived fields
        title_lower = opp["title"].lower()
        org = opp["title"].split(' ')[0]
        if 'university' in title_lower:
            org = 'University'
        elif 'bank' in title_lower:
            org = 'Bank'
        elif 'goldman sachs' in title_lower:
            org = 'Goldman Sachs'
        elif 'kpmg' in title_lower:
            org = 'KPMG'
        elif 'shell' in title_lower:
            org = 'Shell'
            
        opp["org"] = org
        
        # Build description
        desc_parts = []
        if opp["field"]: desc_parts.append(opp["field"])
        if opp["eligibility"]: desc_parts.append(f"Eligibility: {opp['eligibility']}")
        opp["description"] = " — ".join(desc_parts)
        
        # Standardize tags
        opp["tags"] = [current_category]
        if "internship" in opp["type"].lower():
            opp["type"] = "Internship"
        elif "scholarship" in opp["type"].lower():
            opp["type"] = "Scholarship"
        else:
            opp["type"] = "Graduate Trainee"
            
        if "nigeria" in opp["location"].lower():
            opp["location"] = "Nigeria"
        else:
            opp["location"] = "Global / Various"
            
        opp["featured"] = len(opportunities) < 3
        
        opportunities.append(opp)

with open('c:/Users/HP/OneDrive/Desktop/primeopportunity/server/src/seed.json', 'w', encoding='utf-8') as f:
    json.dump(opportunities, f, indent=2)

print(f"Successfully generated seed.json with {len(opportunities)} opportunities!")
