# UBC Sailbot Recruitment — September 2025 (the form this portal replaces)

**Source of truth for question wording.** The `question_schema` seeded in
`supabase/migrations/*_team_postings.sql` is transcribed from here. When a question's wording is in
doubt, this file wins — leads will recognise their own questions, and paraphrasing reads as a bug.

Recruitment opened 2025-08-26 and closed 2025-09-12.

**Structure worth noting**, because it drove the data model: this is ONE form covering every team,
with a yes/no gate per team and a technical quiz behind each, and a single resume upload at the end.
Someone applying to all three fills their name once. That is why one submission writes one
`applications` row per selected team, sharing a `submission_id` and `resume_path`, rather than
forcing three separate applications.

---

## Shared questions

Asked once, before any team gate.

1. Your Full Name *
2. Your Email *
3. Year/Type of Education *
4. Home Department (APSC, IGEN, MECH, ENPH, CPSC, etc.) *
5. Briefly, describe yourself and why you would like to join UBC Sailbot (suggested <50 words)

Fields 1–4 are built-in columns on `applications`. Only field 5 became a `core_question`
(`why_sailbot`) — the genuinely shared question set is exactly one question, and every key added
there becomes a permanent export column for all three teams.

---

## Mechanical Team

Gate: "Do you want to apply to the Mechanical Team?" → Yes continues, No skips the section.

Quiz preamble: *Please answer the below questions using your own knowledge and/or personal research.
If you researched an answer that is completely acceptable, but please include your sources. In
general 2-5 sentences should be sufficient.*

7. What is ballast and what is its function on a boat? *
8. What do most sailboats use instead of ballast? *
9. Why is putting dissimilar metals like aluminum and stainless steel together a problem in a wet
   environment? *
10. Why do you need to paint ERF (epoxy reinforced fiber) surfaces when they will be exposed to
    sunlight? *
11. What is the difference between the center of buoyancy and the center of mass? *
12. What are the names of the different points of sail, and what is the approximate angle between the
    boat and the wind direction for each? *
13. How does a sailboat sail upwind, and what limits its ability to do so? *
14. Why would a sailboat be able to sail faster than the wind observed from shore? *
15. What is the difference between a tack and a gybe in the context of sailing? *
16. Can you briefly describe what a wingsail is and how it works? *
17. Can you list 2-3 challenges of autonomous sailing operation (versus a crewed sailboat)? *

No subteam preference is collected. Mechanical places applicants into Sail / Rudder / Hull after
interviewing.

---

## Electrical Team

Gate: "Do you want to apply to the Electrical Team?"

Quiz preamble: *For most parts of this quiz, Google is your friend, so use it as much as needed! Even
if you are not totally sure on how to solve a particular question, try your best to give a response
and explain your reasoning. We are interested in how you tackle the questions and whether you are
clear in your reasoning, not necessarily in whether you have a correct/perfect solution. (But do not
copy and paste from ChatGPT.)*

19. I confirm that I am available to meet in-person every Saturday. * (Yes/No)
20. Describe a project you've worked on that you're most proud of. *
    1. Explain what you learned
    2. Describe the difficulties you encountered
    3. How would you improve it if you were to do it again

    (Please write your response as if you were explaining it to a first year engineering student.)
21. You are trying to measure current from the battery system using a multimeter. The multimeter is
    set to current mode and you probe between the positive and negative terminal of the battery. Why
    is this a bad idea and potentially dangerous? How else would you measure the current? (write down
    any tools you would use) *
22. What are some advantages and disadvantages of combining battery systems in series and in
    parallel? *
23. A wind sensor and pressure sensor are continuously transmitting data to the same microcontroller.
    What are some considerations to ensure data collection from both sensors at all times? *
24. You have an I2C e-compass that you're trying to receive data from, but are always receiving 0s.
    What are some potential causes of this issue and how would you go about troubleshooting this? *
25. What are some methods for reducing noise in a circuit? *
26. How would you go about verifying and proving the reliability of an electrical system for use in a
    harsh remote environment? *

No subteam preference is collected. Electrical places applicants into COM / DRV / PWR after
interviewing.

---

## Software Team

Gate: "Do you want to apply to the Software Team?"

Stated process: complete the form including a technical quiz → attend a 45-minute interview covering
behavioural questions and the quiz → offers typically within ~3 days of the last interview slot.
Candidates are warned they must be available for the interview.

28. I confirm that I am available to meet in-person every Saturday. * (Yes/No)
29. Please select up to 3 software teams you are most interested in joining, in your order of
    preference.
    Columns: NET | PATH | SIM | WEB | CTRL | DevOps
    Rows: 1st Choice / 2nd Choice / 3rd Choice

    **This is the only subteam ranking on the entire form** — hence `subteam_ranking` being
    per-posting config rather than a universal step.
30. What relevant technical skills do you have? What skills are you interested in learning or further
    developing? Select all that apply.
    Columns: "I have this skill" / "I want to learn/improve this skill"
    Rows: Python · C/C++ · Javascript/Typescript · HTML/CSS · Shell · Visual Studio Code ·
    Git/GitHub · Robot Operating System (ROS) · React · MongoDB · Linux · Docker · Testing (unit,
    integration, mocks) · Data Parsing, Analysis, Visualizing · Web Development · Object-Oriented
    Programming · Continuous Integration (CI/CD) · Physics Modeling · Control Theory · Sailing

    This is the `matrix` question type with `mode: 'multi'` — any combination per row, including
    neither box.
31. Tell us about a software related project you worked on. What did it do? What were the challenges?
    (50 - 100 words)
32. [Technical Quiz] If you chose the GitHub repository submission option, please double check that
    it is public then paste its URL below
33. [Technical Quiz] If you chose the ZIP file submission option, please upload it with the naming
    scheme "Software Technical Quiz \<First name\> \<Last name\>.zip"
34. [Technical Quiz] Which programming language did you use for the technical quiz? *
    - Python
    - C++
    - I opted to answer the projects question
35. Is there anything else we should know about your application?

Question 33 is why `file` is a per-question type and not just the resume field.

---

## Closing

36. Please upload your resume here *

Fallback contacts if upload fails: mech@ubcsailbot.org, electrical@ubcsailbot.org,
software@ubcsailbot.org. Software questions go to software@ubcsailbot.org.

---

## Not covered

**Operations** has no section on this form. It is roughly six people and hires personally, so it is
out of scope for the portal — see the design doc.
