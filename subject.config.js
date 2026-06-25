// subject.config.js — Single source of truth for ALL subject-specific content.
// ─────────────────────────────────────────────────────────────────────────────
// This is the ONLY file you should need to edit when forking this app for a new
// subject. After editing it (and swapping the asset files in /public), run:
//     grep -ri "orlando" . --exclude-dir=node_modules --exclude-dir=.git
// The only hits should be inside THIS file and the asset filenames. Anything
// else is a leftover that defeats the purpose of a clean fork.
//
// Used by both the backend (server.js, src/interviewerAgent.js) and the
// frontend (served via GET /api/config, consumed in public/app.js).
// ─────────────────────────────────────────────────────────────────────────────

const subjectConfig = {
  // ── Identity ───────────────────────────────────────────────────────────────
  name: 'Elizabeth Orlando',
  honorific: 'Ms.',
  // Used in the browser tab + frontend headers
  pageTitle: 'Ms. Elizabeth (Betsy) Orlando — A Life in Service of the World',

  // ── Welcome screen (right panel) ─────────────────────────────────────────────
  ui: {
    // Small logo wordmark (top-left of right panel)
    logoText: 'Betsy Orlando',
    // The big display headline. Plain part + emphasised (italic) part.
    titleLine1: 'A life of',
    titleEmphasis: 'diplomacy & purpose.',
    subtitle:
      'A private biographical interview created especially for Ms. Elizabeth (Betsy) Orlando — to capture three decades of diplomacy, responsible sourcing leadership, and a lifelong commitment to making global supply chains work for people.',
    // Left-panel nameplate
    nameplateName: 'Elizabeth (Betsy) Orlando',
    nameplateTitle: 'Foreign Service Officer · Responsible Sourcing Specialist · Diplomat',
    pullQuote:
      'A US Foreign Service Officer, Policy Innovator, Supply Chain Champion, Mentor, and Citizen of the World.',

    // Left-panel milestone timeline (renders in order)
    timeline: [
      { year: '1996', label: 'Post-doc at MIT' },
      { year: '2017', label: 'Co-founded the JDI' },
      { year: 'Now', label: 'Open to new chapters' },
    ],

    // Right-panel bio fact cards (renders in order)
    bioFacts: [
      { icon: '🌐', label: 'Career', value: 'US Foreign Service Officer, 30+ years' },
      { icon: '💎', label: 'Signature Initiative', value: 'Jewelry Development Impact Index (JDI)' },
      { icon: '⚖️', label: 'Focus Areas', value: 'Conflict diamonds · Conflict minerals · ASM' },
      { icon: '🔬', label: 'Education', value: 'Post-doctoral researcher, MIT (1996)' },
      { icon: '🌍', label: 'Postings', value: 'Nigeria (Abuja), East Asia & Pacific, DC' },
      { icon: '🎖️', label: 'Recognition', value: 'Vatavaran Film Festival Jury · US Consulate Panelist' },
    ],
  },

  // ── Biographical context injected into the LLM system prompts ────────────────
  // This is what makes the interviewer "already know" the subject so it never
  // asks foundational questions it should already have the answer to.
  //
  // ⚠ CAREER FACTS VERIFIED: 25 Jun 2026 against public sources (LinkedIn,
  // University of Delaware MMS programme, National Jeweler coverage, xaviercomm.org,
  // kirticollege.edu.in, cmsvatavaran.org). Specific posting dates and full
  // chronological history not independently verified — confirm with subject.
  interviewerBackground: `KNOWN BACKGROUND (use this to personalise questions — never ask what you already know):
- Full name: Elizabeth Orlando, known professionally and personally as Betsy.
- Accomplished United States Foreign Service Officer with a career spanning more than three decades at the intersection of diplomacy, international affairs, and responsible business conduct.
- Describes herself as an "experienced foreign affairs officer with a demonstrated history of working across the international affairs sphere" — well-travelled, well-read, widely respected.
- Professional centre of gravity: responsible sourcing and the governance of global supply chains, with particular depth in the extractives and jewellery value chains. Worked on conflict diamonds, conflict minerals, and artisanal and small-scale mining (ASM).
- Co-founded the Jewelry Development Impact Index (JDI), a signature evaluative tool measuring how jewellery and gemstone industries affect the societies in which they operate — detailed below.
- Served in the Office of Threat Finance Countermeasures, US Department of State, spearheading the JDI initiative.
- Served in the Oceans, Environment and Scientific Affairs Bureau, Office of Health and Biodefense, US Department of State: covered the Lower Mekong Initiative across East Asia & Pacific, worked on counterfeit and substandard medicines, tobacco control, and electronic-health (E-Med) initiatives; engaged with APEC and East Asia Pacific priorities.
- Overseas posting connected to Abuja, Nigeria, where she was an active Toastmasters leader and mentor within the Aso Rock Stars Club — widely praised as "a phenomenal mentor."
- Post-doctoral researcher at the Massachusetts Institute of Technology (MIT), 1996 — a milestone she reflects on as formative to her later mentorship approach.
- Early leadership profile: Student Government Association President, Honour Society and Gold Key Society member, school newspaper writer, Field Hockey team captain.
- Speaker at the Chicago Responsible Jewelry Conference (October 2017), alongside leading voices in ethical metals and gemstone sourcing.
- Served as a jury member at the Vatavaran Green Frames Short Film Competition and Festival (India's premier environment and wildlife film festival), 2024.
- Panelist at the "Oppenheimer: Science and Cinema" panel discussion hosted at the US Consulate (October 2023), organised by Xavier Institute of Communications — engaging Mumbai's academic and cultural community.
- Represented the US at Deccan Education Society's Kirti M. Doongursee College (Autonomous) India–US Strategic and Economic Partnership Roundtable (April 2025, Mumbai) — a high-level conversation on the bilateral partnership.
- Two-decade friendship with Annurag Batra, prominent Indian media entrepreneur.
- Connected to the responsible-business and anti-corruption community, including Transparency International US.
- Currently open to work and new opportunities, based in Washington D.C. Metro Area.
- LinkedIn headline: "Well-travelled, well-read, accomplished Foreign Service Officer who knows responsible sourcing and business conduct."`,

  // Shorter background for the onboarding prompt
  onboardingBackground: `You already know the following about her professionally:
- Name: Elizabeth Orlando, known as Betsy.
- US Foreign Service Officer, 30+ years; postings include Abuja (Nigeria) and East Asia & Pacific region; current base is Washington D.C. Metro Area.
- Co-founded the Jewelry Development Impact Index (JDI) with Pat Syvrud, growing out of a February 2017 Jewelry Industry Summit — a UN Human Security indicators-based score measuring the impact of jewellery and gemstone industries on producing countries.
- Served in the Office of Threat Finance Countermeasures and the Oceans, Environment and Scientific Affairs Bureau at the US Department of State.
- Post-doctoral researcher at MIT (1996); strong early leadership background including SGA President and Field Hockey team captain.
- Active public speaker, jury member (Vatavaran 2024), and panelist (US Consulate, 2023).`,

  // ── Reference material the subject has authored / participated in ─────────────
  // Publicly documented events and initiatives. Given to the interviewer as CONTEXT
  // to ask richer, more specific questions — NOT as answered coverage. The agent
  // should use it to draw her out (the scene, the people, the feeling, the turning
  // point behind each fact) and to discuss her ideas knowledgeably.
  referenceMaterial: `REFERENCE MATERIAL — public events, initiatives, and documented work.
IMPORTANT: Do NOT treat the contents below as "already covered" or off-limits. Treat them as a map of where the richest stories live. Where these facts appear, your job is to invite her to expand in her own voice — ask for the scene, the people, the emotion, and the lesson behind the fact.

THE JEWELRY DEVELOPMENT IMPACT INDEX (JDI):
- Co-founded with Patricia (Pat) Syvrud, former Executive Director of the World Diamond Council.
- Grew out of group discussions at a Jewelry Industry Summit, February 2017.
- A relative, comparative country score, created within the framework of the United Nations Indicators of Human Security.
- Measures and indicates the degree to which the jewellery and gemstone industries affect the economic and social well-being of the countries in which they function.
- Ultimate purpose: help producing countries advance towards the UN Sustainable Development Goals.
- Developed in partnership with the US Department of Labor, Bureau of International Labor Affairs (ILAB), Office of Child Labor, Forced Labor and Human Trafficking.
- Supported by academic research at American University and the University of Delaware's Minerals, Materials and Society (MMS) programme.
- Comparative case studies across: Botswana, Peru, Colombia, Zambia, South Africa, Madagascar, Myanmar, Afghanistan, Brazil, and Tanzania.
- JDI Advisory Committee included: Natural Resource Governance Institute, the World Bank, and the Responsible Mining Index.
- Positioned as an independent, published score to bring transparency and accountability to global jewellery and gemstone supply chains.

CHICAGO RESPONSIBLE JEWELRY CONFERENCE (OCTOBER 2017):
- Speaker alongside leading voices in ethical metals and gemstone sourcing.
- Focus: educating jewellers, suppliers, educators, and consumers on higher social and ecological standards.

OPPENHEIMER: SCIENCE AND CINEMA PANEL (OCTOBER 2023):
- Panel discussion at the US Consulate General in Mumbai, organised by Xavier Institute of Communications.
- Engaged Mumbai's academic, cultural, and scientific community on the intersection of science, history, and cinema.

VATAVARAN GREEN FRAMES SHORT FILM FESTIVAL (2024):
- Served as a jury member at India's premier environment and wildlife short film competition and festival (CMS VATAVARAN).
- Jury role signals her engagement with environmental storytelling and civil-society cultural initiatives.

INDIA–US STRATEGIC AND ECONOMIC PARTNERSHIP ROUNDTABLE (APRIL 2025):
- High-level roundtable at Deccan Education Society's Kirti M. Doongursee College (Autonomous), Mumbai.
- Discussed India–US strategic and economic partnership — bridging her diplomatic career and her personal ties to India.

ABUJA / NIGERIA POSTING:
- Active mentor and leader within the Toastmasters International Aso Rock Stars Club.
- Described by mentees as "a phenomenal mentor" who welcomed and guided new members.

MIT POST-DOCTORAL RESEARCH (1996):
- Publicly reflected on as formative to her later mentorship of others.
- Raises rich questions about what she researched, how that period shaped her worldview, and what it means to her now.`,

  // {name} and {honorific} are substituted at runtime.
  openings: {
    // Very first message of the very first session (onboarding).
    onboarding: `{honorific} {name}, it is a genuine honour to have this time with you.\n\nBefore we step into the story of your remarkable career, I'd love to spend a few moments simply getting to know you as a person — not the diplomat, not the policy expert, just you. So let's begin simply: where in the world did your life begin, and what kind of family did you grow up in?`,

    // First real interview session (after onboarding done at session creation).
    firstInterview: `Wonderful. Now we can begin.\n\nEvery life has a starting point — a place, a family, a set of circumstances that you didn't choose but that shaped everything that followed. So let's go back to the very beginning.\n\nWhere were you born, and what kind of world did you arrive into?`,

    // Appended when onboarding completes mid-turn.
    onboardingComplete: `\n\nWonderful. Now I feel like I know a little of who I'm talking to.\n\nLet's begin. Every life has a starting point — a place, a set of circumstances you didn't choose but that shaped everything that followed. Take me back to the very beginning: where were you born, and what was the world like when you arrived?`,
  },
};

// Substitute {name} / {honorific} placeholders in a template string.
function render(template) {
  if (!template) return template;
  return template
    .replace(/\{name\}/g, subjectConfig.name)
    .replace(/\{honorific\}/g, subjectConfig.honorific);
}

// The subset of config that is safe + useful to expose to the frontend.
// (Excludes the LLM prompt internals.)
function publicConfig() {
  return {
    name: subjectConfig.name,
    honorific: subjectConfig.honorific,
    pageTitle: subjectConfig.pageTitle,
    ui: subjectConfig.ui,
  };
}

module.exports = { subjectConfig, render, publicConfig };
