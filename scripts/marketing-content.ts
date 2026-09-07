export interface ArticleSection {
  heading: string;
  paragraphs: string[];
  bullets?: string[];
}

export interface ArticleSource {
  title: string;
  url: string;
}

export interface MarketingGuide {
  slug: string;
  title: string;
  description: string;
  category: string;
  intro: string[];
  sections: ArticleSection[];
  sources: ArticleSource[];
}

export const marketingGuides: MarketingGuide[] = [
  {
    slug: "hybrid-training-plan",
    title: "How to build a hybrid training plan",
    description:
      "Set priorities and fit running, lifting and other sports around your current training.",
    category: "Planning foundations",
    intro: [
      "A hybrid training plan brings endurance and strength work into the same overall routine. Researchers usually call this concurrent training. You do not need to race, lift competitively, or split your time equally between the two to use the idea.",
      "The useful question is not how to combine two complete specialist plans. It is which running and lifting sessions deserve space in your actual week. That starts with a priority, an honest starting point, and permission to leave some work out.",
    ],
    sections: [
      {
        heading: "Know what the evidence supports",
        paragraphs: [
          "Running and lifting are not automatically incompatible. Schumann and colleagues' 2022 systematic review combined results from 43 studies comparing concurrent training with the same strength training performed alone. On average, it found no clear reduction in maximal strength or muscle growth. Maximal strength means the greatest force you can produce; muscle growth is also called hypertrophy.",
          "Explosive strength, the ability to produce force quickly, showed a less reassuring pattern, particularly when endurance and strength work shared a session. These are different outcomes, not interchangeable measures of being fit. Most included studies were of moderate methodological quality, and endurance intensity was inconsistently reported. The findings support combining activities, not unlimited training or a guarantee that every combination suits you.",
        ],
      },
      {
        heading: "Give the week a primary purpose",
        paragraphs: [
          "Choose which goal should guide a difficult scheduling decision. A primary goal gets first consideration when sessions compete; a supporting goal still matters, but does not need to expand at the same time. This is a practical way to make trade-offs, not a research-derived formula for dividing training.",
          "Describe your priority in a sentence you could use while looking at next week's calendar. Make it specific enough to settle a conflict without turning every session into a test.",
        ],
        bullets: [
          "Running priority: keep the established runs that matter most to you, and fit familiar strength work around them.",
          "Lifting priority: protect the lifting sessions you want to perform well, rather than adding running wherever there is empty space.",
          "General fitness priority: choose a mix you can repeat and enjoy, without treating either activity as something you must maximize.",
        ],
      },
      {
        heading: "Use your recent routine as the starting point",
        paragraphs: [
          "Write down what you actually completed recently: usual runs, familiar lifts, available equipment, and realistic session windows. Include sport outside the gym. A busy team practice uses time and effort even if it is not called a workout in your plan.",
          "Separate observations from intentions. Wanting to run more does not make that running an established baseline. Volume means the amount of work, such as running minutes or lifting sets; intensity describes how demanding it is. Changing both at once also makes it harder to understand why a week felt different. A recommended exercise is a suggestion to consider, not evidence that you have already performed it.",
        ],
      },
      {
        heading: "An illustrative week, not a prescribed split",
        paragraphs: [
          "Imagine someone already accustomed to the following sessions who wants to keep a Saturday social run as their running priority. This is an editorial example, not an app-generated schedule or a recommendation to adopt these session counts.",
        ],
        bullets: [
          "Monday: a familiar lifting session in the available gym window.",
          "Tuesday: the usual easy run, at an effort that allows conversation.",
          "Wednesday: a fixed evening commitment, with no training added.",
          "Thursday: the other established lifting session.",
          "Friday: no planned training, rather than a compulsory extra workout.",
          "Saturday: the established social run; Sunday stays free.",
        ],
      },
      {
        heading: "Review the fit before adding more",
        paragraphs: [
          "In that example, Thursday is worth reviewing if the person repeatedly reaches Saturday unusually tired. Possible changes include reducing optional lifting work or reconsidering placement. Simply declaring Saturday the priority does not make the preceding work disappear. Conversely, a lifting-focused person might protect the gym windows and reconsider optional running instead.",
          "Review what happened, not just whether the calendar looks balanced. Were sessions rushed? Did a familiar workload become difficult to repeat? Were the time estimates realistic? These observations can inform a decision without diagnosing fatigue or predicting adaptation. The ACSM's 2026 position stand distinguishes meaningful improvement from maximizing a particular outcome; a workable routine need not pursue every possible gain.",
        ],
      },
      {
        heading: "Use the planner for organization, not physiological certainty",
        paragraphs: [
          "Hybrid Coach is a free, MIT-licensed, local-first planner: a static browser app storing training data in IndexedDB, with no accounts or tracking. Setup uses your observed starting point and clearly identified recommended exercises. Log the weights you actually use per set; the app does not automatically increase them.",
          "Optional AI can propose a complete week. You and your AI choose training frequency, rest and progression; the app surfaces training concerns as advice and checks data, equipment and recorded-work integrity. You review and approve the week. Initial weights are not guessed. The built-in route remains conservative. Neither route measures readiness, guarantees results or replaces individual coaching.",
        ],
      },
    ],
    sources: [
      {
        title:
          "Compatibility of Concurrent Aerobic and Strength Training for Skeletal Muscle Size and Function: An Updated Systematic Review and Meta-Analysis",
        url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC8891239/",
      },
      {
        title:
          "American College of Sports Medicine Position Stand. Resistance Training Prescription for Muscle Function, Hypertrophy, and Physical Performance in Healthy Adults: An Overview of Reviews",
        url: "https://www.ovid.com/jnls/acsm-msse/fulltext/10.1249/mss.0000000000003897~american-college-of-sports-medicine-position-stand",
      },
    ],
  },
  {
    slug: "running-and-lifting-same-day",
    title: "Running and lifting on the same day",
    description:
      "Choose which session comes first and when to separate running and lifting.",
    category: "Session scheduling",
    intro: [
      "Running and lifting on the same day can be a practical way to fit both into your life. It does not automatically cancel the benefits of either activity. But doing a run immediately before lifting is a different arrangement from running in the morning and lifting later.",
      "Separate two decisions: which session needs your freshest effort, and whether the combined workload belongs on that day at all. Reordering work cannot make an unrealistic amount of training realistic.",
    ],
    sections: [
      {
        heading: "Interference is not the same as feeling tired",
        paragraphs: [
          "In training research, interference means smaller long-term gains from combined training than from an otherwise comparable single-mode program. Feeling tired during today's second session is an immediate response. The two can be related, but one tired workout does not establish that you are losing adaptations.",
          "Schumann and colleagues' 2022 review found no clear average disadvantage for maximal strength or muscle growth when aerobic work accompanied strength training. Explosive strength, meaning how quickly force can be produced, was more sensitive. This is why a claim about power development should not become a claim that every easy run undermines every lift. The mechanisms remain uncertain; the body is not governed by a simple running-versus-muscle switch.",
        ],
      },
      {
        heading: "Choose the order using the outcome you care about",
        paragraphs: [
          "For strength-focused training, there is a reasonable case for lifting first. Eddens and colleagues' systematic review of same-session exercise order found greater improvement in lower-body dynamic strength when resistance exercise preceded endurance exercise. Dynamic strength here refers to force expressed through movement, as in the lifting tests used in the studies.",
          "That review did not find a clear order advantage for muscle growth or maximal aerobic capacity, the body's maximum ability to use oxygen during exercise. It mainly concerned relatively untrained or recreational participants. It does not settle every question about experienced runners, race performance, or demanding sessions. No difference detected in a pooled outcome is not proof that order never matters.",
          "If a particular run is your priority, putting it first can be a sensible practical choice to avoid arriving already tired. Treat that as prioritization, not a proven universal method for better running results. If you are learning a lift, also account for the attention needed to practise it rather than squeezing it into a hurried finish.",
        ],
      },
      {
        heading: "Use separation as an option, not a magic threshold",
        paragraphs: [
          "In the 2022 review, reduced explosive-strength gains were more apparent in same-session training. The subgroup with sessions separated by at least three hours did not show a statistically clear reduction. That timing describes how the available studies were grouped; it is not proof that a three-hour wait guarantees recovery or eliminates interference.",
          "A morning-and-evening arrangement may give you more room to eat, rest, and approach the second session deliberately. It also adds another change of clothes, travel window, and warm-up. If splitting sessions makes the week unworkable, a manageable combined session can be the more useful arrangement. Do not sacrifice sleep just to satisfy a timing rule the evidence does not establish.",
        ],
      },
      {
        heading: "Look at the actual sessions, not just their labels",
        paragraphs: [
          "A familiar conversational run and an unusually demanding run are both running, but they are not equivalent scheduling demands. The same applies to different lifting sessions. Look at duration, effort, familiarity, and how much both sessions ask of the same muscles. An upper-body emphasis changes that overlap, but does not make a run cost-free.",
          "Decide what could be omitted before starting. Optional work is work that can leave the plan without displacing the day's main purpose. Keeping every exercise while rushing transitions or removing the time needed between sets is not necessarily a successful compromise. Changing the workload is a separate decision from changing its order.",
        ],
      },
      {
        heading: "An illustrative week with a shared training day",
        paragraphs: [
          "Consider someone already familiar with these workloads who has gym access on Monday and Friday. This is an illustrative scheduling example, not an app-generated plan, a starting prescription, or a target number of sessions.",
        ],
        bullets: [
          "Monday: familiar lifting followed later by the usual easy run, if separate windows genuinely exist.",
          "Wednesday: the other established run, without a lifting session added.",
          "Friday: the other familiar lifting session.",
          "Tuesday, Thursday, and the weekend: no additional training assigned in this example.",
        ],
      },
      {
        heading: "Check whether the arrangement remains repeatable",
        paragraphs: [
          "If Monday only offers one continuous window, lifting followed by the familiar easy run is an alternative to consider for this strength-prioritizing example. If that combination repeatedly leaves the second activity rushed or unexpectedly demanding, reassess it rather than treating completion as the only success measure. Removing optional work is an available outcome, not a debt to repay later.",
          "Record the actual work, including weights per set, and compare similar sessions rather than isolated best performances. Hybrid Coach lets you move sessions and review constraints, but its scheduling estimates are not measurements of biological recovery. There is no validated readiness score or automatic load increase. A tidy calendar cannot tell you with certainty how your next session will feel.",
        ],
      },
    ],
    sources: [
      {
        title:
          "Compatibility of Concurrent Aerobic and Strength Training for Skeletal Muscle Size and Function: An Updated Systematic Review and Meta-Analysis",
        url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC8891239/",
      },
      {
        title:
          "The Role of Intra-Session Exercise Sequence in the Interference Effect: A Systematic Review with Meta-Analysis",
        url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC5752732/",
      },
    ],
  },
  {
    slug: "hybrid-training-busy-schedule",
    title: "Hybrid training around a busy schedule",
    description:
      "Plan around fixed commitments, missed sessions and rest, without catch-up work.",
    category: "Training around life",
    intro: [
      "A busy week needs decisions about what will not happen, not just a more tightly packed calendar. Work, caring responsibilities, travel, and sport all compete with running and lifting. A plan that ignores them is already asking you to improvise.",
      "Start by protecting a realistic version of your established routine. That is a different goal from extracting the largest possible training response. You can make the week useful without claiming that a reduced schedule preserves every aspect of fitness.",
    ],
    sections: [
      {
        heading: "Put fixed commitments on the calendar first",
        paragraphs: [
          "Mark the obligations you cannot move before placing optional training. Include the travel, changing, and setup time around a session, not only the minutes spent running or lifting. A gym window that exists only if every meeting ends early is not dependable availability.",
          "Distinguish an unavailable evening from an evening occupied by another sport. Both block time, but sport also adds physical work. In Hybrid Coach, commitments and pinned sessions constrain the calendar; a pin is your instruction to keep placement fixed, not proof that the surrounding week is manageable. Avoid pinning everything just because it appeared in your first draft.",
        ],
      },
      {
        heading: "Choose a smaller plan deliberately",
        paragraphs: [
          "Identify the sessions that best represent your current priority, then name the optional work you would remove first. Volume means the amount of training; it is not a measure of personal commitment. A shorter week need not contain the same volume compressed into fewer, harder visits.",
          "Currier and colleagues' 2023 network meta-analysis compared resistance-training prescriptions across different loads, sets, and frequencies. The studied prescriptions improved strength and muscle size compared with no training. Some ranked higher for particular outcomes, but the findings do not establish that a tiny dose equals a larger one, or that any improvised routine will maintain an experienced athlete's performance.",
          "The ACSM's 2026 position stand likewise distinguishes improving from maximizing results and emphasizes individualization. Use that distinction to make realistic choices, not to search for a universal minimum that supposedly covers every running and lifting goal.",
        ],
      },
      {
        heading: "A time problem and a fatigue problem need different responses",
        paragraphs: [
          "A missed session after a late meeting tells you that a time slot failed. A session skipped because you feel unusually fatigued tells you something different. Neither observation measures your physiology precisely, but treating them as identical loses useful information.",
          "For a time conflict, look for another suitable opening and review what surrounds it. Moving work can solve an availability problem, but only if it still fits the rest of the week. For fatigue, simply moving the same workload to tomorrow may preserve the very demand you meant to reduce.",
          "Hybrid Coach makes this distinction explicit: a time-related skip rearranges remaining work, while a fatigue skip reduces future optional work. Neither creates catch-up volume. This is a conservative product policy, not a medically validated recovery model. Uncompleted work is not a balance you owe the calendar.",
        ],
      },
      {
        heading: "An illustrative deadline week",
        paragraphs: [
          "Imagine someone whose established routine contains a Monday lift, a Wednesday easy run, and a Saturday lift. Tuesday and Thursday are unavailable, Friday is a possible buffer, and Sunday is kept free. These session counts are illustrative, not an app-generated plan or a suggested balance for every goal.",
        ],
        bullets: [
          "If Wednesday's run is missed because a meeting overruns, Friday can be considered only after checking its fit with Saturday.",
          "If Friday is unavailable or would make the remaining week too demanding, omit the missed run rather than attach it to Saturday.",
          "If the run is skipped because of fatigue, reconsider optional work instead of automatically using the buffer.",
          "Keep Sunday's unassigned time unassigned; it is not a compulsory catch-up slot.",
        ],
      },
      {
        heading: "Keep rest and ordinary movement in perspective",
        paragraphs: [
          "An empty calendar square can be intentional. Rest is not wasted scheduling capacity, and a spare hour does not tell you that more training is appropriate. Avoid creating a routine that repeatedly takes time from sleep or relies on rushing every lifting session.",
          "The World Health Organization emphasizes that some physical activity is better than none and that activity beyond formal exercise counts. That is a population-health message, not proof that a walk replaces a planned run or provides the same training stimulus. Ordinary movement can still belong in a busy life without being converted into another performance target.",
        ],
      },
      {
        heading: "Review the constraints, not your willpower",
        paragraphs: [
          "At the end of the week, ask which openings were reliable, which sessions took longer than expected, and why work was skipped. Repeated time conflicts suggest revising availability. Repeated fatigue-related changes suggest reconsidering demands, not just finding a more persuasive reminder. Change the next plan using those distinctions rather than drawing conclusions from a completion percentage.",
          "Use the planner to keep a clear record of what actually happened. Weights are logged per set; planned values are not completed work. You can review Garmin activity-summary CSV exports locally. They do not confirm your current training or mark planned sessions complete; FIT and Apple Health imports are not supported. Training records are saved in your browser's IndexedDB, with no account or tracking. The useful output is an honest, workable record, not a guarantee that the engine has optimized your biology.",
        ],
      },
    ],
    sources: [
      {
        title:
          "Resistance training prescription for muscle strength and hypertrophy in healthy adults: a systematic review and Bayesian network meta-analysis",
        url: "https://bjsm.bmj.com/content/57/18/1211",
      },
      {
        title:
          "American College of Sports Medicine Position Stand. Resistance Training Prescription for Muscle Function, Hypertrophy, and Physical Performance in Healthy Adults: An Overview of Reviews",
        url: "https://www.ovid.com/jnls/acsm-msse/fulltext/10.1249/mss.0000000000003897~american-college-of-sports-medicine-position-stand",
      },
      {
        title: "Physical activity",
        url: "https://www.who.int/news-room/fact-sheets/detail/physical-activity",
      },
    ],
  },
];
