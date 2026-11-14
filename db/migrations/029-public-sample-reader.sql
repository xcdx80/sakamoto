-- Public reader examples are separate from personal briefs, notes, and sync.
create table public_sample_reader (
  article_id text primary key,
  brief jsonb not null check (jsonb_typeof(brief) = 'object'),
  glosses jsonb not null check (jsonb_typeof(glosses) = 'array')
);

insert into public_sample_reader (article_id, brief, glosses) values
  ('self-reliance', $sample${
  "gist": "Emerson argues that people give up their own judgment to gain society’s approval. His alternative is to act on what you sincerely see now and to speak just as plainly when your judgment changes.",
  "claims": [
    {
      "text": "Society rewards conformity by making acceptance and security feel conditional.",
      "cite": 6
    },
    {
      "text": "Fidelity to present judgment can require contradicting a view you held yesterday.",
      "cite": 14
    },
    {
      "text": "Emerson sees dependence on property and status as another form of surrendering self-trust.",
      "cite": 50
    }
  ],
  "caveats": [
    {
      "text": "The case for self-trust is a philosophical argument; the essay gives no independent test for distinguishing insight from overconfidence.",
      "cite": 0
    }
  ],
  "sections": [
    {
      "title": "Trusting your own thought",
      "start": 1
    },
    {
      "title": "The price of conformity",
      "start": 6
    },
    {
      "title": "Changing your mind",
      "start": 12
    },
    {
      "title": "Self-trust in practice",
      "start": 29
    }
  ]
}$sample$::jsonb, $sample$[
  {
    "id": "example:self-reliance:1",
    "articleId": "self-reliance",
    "action": "ask",
    "question": "What does the joint-stock company metaphor say we give up in exchange for belonging?",
    "anchor": {
      "start": {
        "b": "p6",
        "o": 195
      },
      "end": {
        "b": "p6",
        "o": 365
      },
      "quote": "Society is a joint-stock company, in which the members agree, for the better securing of his bread to each shareholder, to surrender the liberty and culture of the eater."
    },
    "turns": [
      {
        "role": "assistant",
        "content": "The bargain is security for independence: each member gets a more secure livelihood, while the group pressures people to think and act alike. The point is that conformity can pay in the short run, which helps explain why it is hard to resist. [¶6]"
      }
    ],
    "createdAt": 0
  },
  {
    "id": "example:self-reliance:2",
    "articleId": "self-reliance",
    "action": "ask",
    "question": "How can changing your mind be a form of integrity here?",
    "anchor": {
      "start": {
        "b": "p14",
        "o": 229
      },
      "end": {
        "b": "p14",
        "o": 467
      },
      "quote": "Speak what you think now in hard words and to-morrow speak what to-morrow thinks in hard words again, though it contradict every thing you said to-day.—‘Ah, so you shall be sure to be misunderstood.’—Is it so bad then to be misunderstood?"
    },
    "turns": [
      {
        "role": "assistant",
        "content": "Emerson is asking for consistency in how you judge, rather than consistency in what you conclude. If your honest judgment changes, repeating the old conclusion to protect your reputation would betray the very independence you were trying to preserve. [¶12] [¶14]"
      }
    ],
    "createdAt": 0
  }
]$sample$::jsonb),
  ('liberty-of-discussion', $sample${
  "gist": "Mill argues that suppressing a disputed opinion puts the censor’s fallible judgment beyond correction. An opinion earns practical confidence by surviving serious challenges, and punishment can keep those challenges out of public view for generations.",
  "claims": [
    {
      "text": "Even strong conviction cannot guarantee that a suppressed opinion is false.",
      "cite": 3
    },
    {
      "text": "A belief that survives opportunities for rebuttal has a stronger claim on our confidence than one shielded from rebuttal.",
      "cite": 6
    },
    {
      "text": "The truth has no automatic protection from repression.",
      "cite": 17
    },
    {
      "text": "Social stigma can stifle inquiry even when dissenters avoid legal punishment.",
      "cite": 20
    }
  ],
  "caveats": [
    {
      "text": "This excerpt develops the argument that a silenced opinion may be true; Mill treats the other case later in the chapter.",
      "cite": 2
    }
  ],
  "sections": [
    {
      "title": "Who can decide for everyone?",
      "start": 1
    },
    {
      "title": "Acting on fallible judgment",
      "start": 5
    },
    {
      "title": "The record of persecution",
      "start": 11
    },
    {
      "title": "Pressure without prosecution",
      "start": 18
    }
  ]
}$sample$::jsonb, $sample$[
  {
    "id": "example:liberty-of-discussion:1",
    "articleId": "liberty-of-discussion",
    "action": "ask",
    "question": "Does Mill think we have to wait for certainty before acting?",
    "anchor": {
      "start": {
        "b": "p6",
        "o": 268
      },
      "end": {
        "b": "p6",
        "o": 515
      },
      "quote": "Complete liberty of contradicting and disproving our opinion, is the very condition which justifies us in assuming its truth for purposes of action; and on no other terms can a being with human faculties have any rational assurance of being right."
    },
    "turns": [
      {
        "role": "assistant",
        "content": "No. Mill draws a line between acting on the best judgment available and forbidding others to challenge it. A decision can be justified today even though the reasons for it remain open to correction tomorrow. [¶5] [¶6]"
      }
    ],
    "createdAt": 0
  },
  {
    "id": "example:liberty-of-discussion:2",
    "articleId": "liberty-of-discussion",
    "action": "ask",
    "question": "Why doesn’t Mill take the eventual survival of an idea as proof that censorship was harmless?",
    "anchor": {
      "start": {
        "b": "p17",
        "o": 208
      },
      "end": {
        "b": "p17",
        "o": 270
      },
      "quote": "History teems with instances of truth put down by persecution."
    },
    "turns": [
      {
        "role": "assistant",
        "content": "What survives is a poor measure of what was lost. Mill points to ideas suppressed for centuries and to repeated attempts at religious reform that were put down. Eventual recognition cannot restore the generations who had no chance to hear or test those ideas. [¶17]"
      }
    ],
    "createdAt": 0
  }
]$sample$::jsonb),
  ('division-of-labour', $sample${
  "gist": "Smith uses a pin factory to explain why a group of specialists can make much more than the same people working independently. He traces the gain to practice, less time lost switching tasks, and the invention and improvement of tools.",
  "claims": [
    {
      "text": "Pinmaking becomes much more productive when separate workers handle distinct operations.",
      "cite": 3
    },
    {
      "text": "Specialization improves dexterity, reduces switching time, and encourages labor-saving machinery.",
      "cite": 5
    },
    {
      "text": "An ordinary coat depends on a long chain of specialized workers and suppliers.",
      "cite": 11
    }
  ],
  "caveats": [
    {
      "text": "The pin factory illustrates the productivity mechanism; it does not measure the effects of specialization on the workers themselves.",
      "cite": 3
    }
  ],
  "sections": [
    {
      "title": "The factory example",
      "start": 1
    },
    {
      "title": "Where the gains come from",
      "start": 5
    },
    {
      "title": "Specialization beyond the factory",
      "start": 10
    }
  ]
}$sample$::jsonb, $sample$[
  {
    "id": "example:division-of-labour:1",
    "articleId": "division-of-labour",
    "action": "ask",
    "question": "Would Smith expect specialization to help even before anyone invents a machine?",
    "anchor": {
      "start": {
        "b": "p5",
        "o": 190
      },
      "end": {
        "b": "p5",
        "o": 501
      },
      "quote": "first, to the increase of dexterity in every particular workman; secondly, to the saving of the time which is commonly lost in passing from one species of work to another; and, lastly, to the invention of a great number of machines which facilitate and abridge labour, and enable one man to do the work of many."
    },
    "turns": [
      {
        "role": "assistant",
        "content": "Yes. Two of his three explanations require no new machinery. Repeating a task improves dexterity, and sticking with it avoids the lost time of moving between tools, locations, or kinds of work. Machinery can add a third gain on top. [¶5] [¶6] [¶7]"
      }
    ],
    "createdAt": 0
  },
  {
    "id": "example:division-of-labour:2",
    "articleId": "division-of-labour",
    "action": "ask",
    "question": "Why does Smith end with an ordinary worker’s coat instead of another factory?",
    "anchor": {
      "start": {
        "b": "p11",
        "o": 287
      },
      "end": {
        "b": "p11",
        "o": 454
      },
      "quote": "The woollen coat, for example, which covers the day-labourer, as coarse and rough as it may appear, is the produce of the joint labour of a great multitude of workmen."
    },
    "turns": [
      {
        "role": "assistant",
        "content": "The coat makes the network visible. Shepherds, spinners, weavers, merchants, and transport workers all contribute without sharing one workshop. Smith moves from the output of a single team to the cooperation hidden inside an everyday object. [¶10] [¶11]"
      }
    ],
    "createdAt": 0
  }
]$sample$::jsonb),
  ('broken-window', $sample${
  "gist": "A broken window creates visible work for a glazier and hides the purchase the shopkeeper would otherwise have made. Bastiat compares both outcomes to show why spending to replace a loss is different from becoming better off.",
  "claims": [
    {
      "text": "The repair creates real revenue for the glazier.",
      "cite": 6
    },
    {
      "text": "The same six francs cannot also pay for the purchase the shopkeeper gives up.",
      "cite": 8
    },
    {
      "text": "Without the break, the shopkeeper could have kept the window and bought shoes.",
      "cite": 13
    }
  ],
  "caveats": [
    {
      "text": "The example assumes the same money would have been spent elsewhere; it does not settle what happens when that assumption fails.",
      "cite": 11
    }
  ],
  "sections": [
    {
      "title": "Seen and unseen effects",
      "start": 1
    },
    {
      "title": "The glazier’s gain",
      "start": 4
    },
    {
      "title": "The purchase displaced",
      "start": 8
    },
    {
      "title": "What society loses",
      "start": 12
    }
  ]
}$sample$::jsonb, $sample$[
  {
    "id": "example:broken-window:1",
    "articleId": "broken-window",
    "action": "ask",
    "question": "Do we need to know exactly what the shopkeeper would have bought?",
    "anchor": {
      "start": {
        "b": "p8",
        "o": 110
      },
      "end": {
        "b": "p8",
        "o": 254
      },
      "quote": "It is not seen that if he had not had a window to replace, he would, perhaps, have replaced his old shoes, or added another book to his library."
    },
    "turns": [
      {
        "role": "assistant",
        "content": "No. Bastiat offers shoes and a book as possibilities. The point is that paying for repairs closes off alternatives. For his claim about the *same amount of trade* to hold, though, he does assume the shopkeeper would otherwise have spent the six francs. [¶8] [¶10] [¶11]"
      }
    ],
    "createdAt": 0
  },
  {
    "id": "example:broken-window:2",
    "articleId": "broken-window",
    "action": "ask",
    "question": "Both versions involve spending six francs. Why is the shopkeeper poorer in one?",
    "anchor": {
      "start": {
        "b": "p13",
        "o": 0
      },
      "end": {
        "b": "p13",
        "o": 193
      },
      "quote": "In the second, where we suppose the window not to have been broken, he would have spent six francs in shoes, and would have had at the same time the enjoyment of a pair o shoes and of a window."
    },
    "turns": [
      {
        "role": "assistant",
        "content": "In one version the money merely restores the window he already had. In the other he keeps the original window and gains shoes. Counting transactions gives the same answer; counting what the shopkeeper ends up with exposes the loss. [¶12] [¶13] [¶14]"
      }
    ],
    "createdAt": 0
  }
]$sample$::jsonb),
  ('feature-visualization', $sample${
  "gist": "Feature visualization changes an input to see what drives a particular neural activation. The authors show why comparing multiple optimized examples with real dataset examples can reveal a feature’s range and expose misleading artifacts.",
  "claims": [
    {
      "text": "Input gradients can guide a synthetic image toward stronger activation of a chosen feature.",
      "cite": 1
    },
    {
      "text": "Optimized inputs can help distinguish what drives a response from what merely accompanies it in real examples.",
      "cite": 9
    },
    {
      "text": "A diversity objective can surface multiple inputs that activate the same feature.",
      "cite": 17
    }
  ],
  "caveats": [
    {
      "text": "Pushing generated examples to differ can introduce artifacts; an optimized image alone is an incomplete explanation.",
      "cite": 23
    }
  ],
  "sections": [
    {
      "title": "Optimizing an input",
      "start": 1
    },
    {
      "title": "Why use synthetic examples?",
      "start": 8
    },
    {
      "title": "Finding multiple facets",
      "start": 12
    }
  ]
}$sample$::jsonb, $sample$[
  {
    "id": "example:feature-visualization:1",
    "articleId": "feature-visualization",
    "action": "ask",
    "question": "What can an optimized image tell us that the top-scoring dataset images might not?",
    "anchor": {
      "start": {
        "b": "p9",
        "o": 112
      },
      "end": {
        "b": "p9",
        "o": 211
      },
      "quote": "because it separates the things causing behavior from things that merely correlate with the causes."
    },
    "turns": [
      {
        "role": "assistant",
        "content": "Dataset images can share incidental features, such as a background common to photos of a particular object. Optimization can generate an input that drives the same unit without reproducing all those correlations. The strongest reading compares the two kinds of evidence, because optimization can introduce its own artifacts. [¶9] [¶11] [¶23]"
      }
    ],
    "createdAt": 0
  },
  {
    "id": "example:feature-visualization:2",
    "articleId": "feature-visualization",
    "action": "ask",
    "question": "If all the images activate the same neuron, why deliberately make them different?",
    "anchor": {
      "start": {
        "b": "p17",
        "o": 56
      },
      "end": {
        "b": "p17",
        "o": 163
      },
      "quote": "adding a “diversity term” to one’s objective that pushes multiple examples to be different from each other."
    },
    "turns": [
      {
        "role": "assistant",
        "content": "A single maximum shows one way to make the unit fire. Multiple different examples can reveal less obvious ways of doing so, and sometimes suggest that a neuron responds to unrelated features. The diversity penalty itself can also manufacture differences, so the result needs checking. [¶12] [¶17] [¶23] [¶25]"
      }
    ],
    "createdAt": 0
  }
]$sample$::jsonb),
  ('introduction-to-circuits', $sample${
  "gist": "The authors argue that some learned vision features and the connections between them can be understood in human terms. They make the case through examples where simpler detectors combine into larger ones, while showing why a single neuron does not always correspond to one feature.",
  "claims": [
    {
      "text": "A single neuron can respond to several semantically unrelated inputs.",
      "cite": 29
    },
    {
      "text": "The weights connecting early and later curve detectors have a spatial structure that helps explain the later detector.",
      "cite": 42
    },
    {
      "text": "A dog-head circuit combines pathways for different orientations into a more invariant response.",
      "cite": 50
    }
  ],
  "caveats": [
    {
      "text": "The authors call their broad claims speculative; these selected vision circuits do not establish how generally the approach works.",
      "cite": 4
    }
  ],
  "sections": [
    {
      "title": "The research program",
      "start": 1
    },
    {
      "title": "Features and their limits",
      "start": 6
    },
    {
      "title": "Reading circuits from weights",
      "start": 33
    },
    {
      "title": "How circuits combine cases",
      "start": 47
    }
  ]
}$sample$::jsonb, $sample$[
  {
    "id": "example:introduction-to-circuits:1",
    "articleId": "introduction-to-circuits",
    "action": "ask",
    "question": "Why is a neuron that fires for cats and cars a problem for naming neurons?",
    "anchor": {
      "start": {
        "b": "p29",
        "o": 86
      },
      "end": {
        "b": "p29",
        "o": 123
      },
      "quote": "respond to multiple unrelated inputs."
    },
    "turns": [
      {
        "role": "assistant",
        "content": "A single name can hide materially different causes of the same activation. The authors distinguish the neuron, which is one coordinate of the network, from the features it may help represent. You can still study what drives each response, but labeling the unit by only one of them loses information. [¶29] [¶30] [¶31]"
      }
    ],
    "createdAt": 0
  },
  {
    "id": "example:introduction-to-circuits:2",
    "articleId": "introduction-to-circuits",
    "action": "ask",
    "question": "What would make this a circuit explanation rather than just a descriptive label?",
    "anchor": {
      "start": {
        "b": "p42",
        "o": 23
      },
      "end": {
        "b": "p42",
        "o": 85
      },
      "quote": "positive weights, arranged in the shape of the curve detector."
    },
    "turns": [
      {
        "role": "assistant",
        "content": "A label tells us when the later neuron fires. The circuit shows how the result is assembled: positive weights link earlier detectors to specific spatial positions, with orientations that trace the larger curve. The pattern rotating with the detected curve is another check that the mechanism fits the behavior. [¶41] [¶42] [¶46]"
      }
    ],
    "createdAt": 0
  }
]$sample$::jsonb),
  ('test-campaigns', $sample${
  "gist": "Hopkins would put a new offer in front of a few towns before spending on national advertising. He wants buyers to settle the argument through purchase, repeat purchase, and how quickly the profit repays the cost of winning them.",
  "claims": [
    {
      "text": "A small campaign can track whether trial converts to purchase and whether customers keep buying.",
      "cite": 8
    },
    {
      "text": "The time it takes to recover acquisition costs determines how the larger campaign must be financed.",
      "cite": 11
    },
    {
      "text": "Test campaigns can improve an existing campaign without interrupting what already works.",
      "cite": 22
    }
  ],
  "caveats": [
    {
      "text": "Hopkins treats small-market averages as more reliable than they are; differing audiences or rising acquisition costs can change the result at scale.",
      "cite": 7
    }
  ],
  "sections": [
    {
      "title": "Why go to buyers?",
      "start": 1
    },
    {
      "title": "Testing before expansion",
      "start": 6
    },
    {
      "title": "Learning from product tests",
      "start": 17
    },
    {
      "title": "Improving a working campaign",
      "start": 22
    }
  ]
}$sample$::jsonb, $sample$[
  {
    "id": "example:test-campaigns:1",
    "articleId": "test-campaigns",
    "action": "ask",
    "question": "Why isn’t redeeming a free sample enough to declare the campaign a success?",
    "anchor": {
      "start": {
        "b": "p8",
        "o": 189
      },
      "end": {
        "b": "p8",
        "o": 232
      },
      "quote": "will they continue? How much will they buy?"
    },
    "turns": [
      {
        "role": "assistant",
        "content": "A sample measures willingness to try when the price is low or zero. Hopkins wants to know whether those people buy afterward, whether they repeat, and how long their profit contribution takes to cover the cost of reaching them. Each step can fail even when the sample offer appears popular. [¶3] [¶8] [¶11]"
      }
    ],
    "createdAt": 0
  },
  {
    "id": "example:test-campaigns:2",
    "articleId": "test-campaigns",
    "action": "ask",
    "question": "What did the first coupon test actually establish, and what remained uncertain?",
    "anchor": {
      "start": {
        "b": "p19",
        "o": 143
      },
      "end": {
        "b": "p19",
        "o": 191
      },
      "quote": "They were almost unanimous in their disapproval."
    },
    "turns": [
      {
        "role": "assistant",
        "content": "It gave the advertiser a reason to stop one proposed change: the participating customers disliked that specific version. It did not rule out changing the product entirely. A later test of a different version found more interest, although Hopkins reports a preference vote, not the eventual sales result. [¶19] [¶20] [¶21]"
      }
    ],
    "createdAt": 0
  }
]$sample$::jsonb),
  ('effects-of-advertisements', $sample${
  "gist": "Münsterberg treats remembering an advertisement as one step between seeing it and buying the product. He describes experiments on size and repetition and warns that the result also depends on what was shown, when, and where.",
  "claims": [
    {
      "text": "An advertisement can influence a later purchase by staying in memory.",
      "cite": 4
    },
    {
      "text": "Readers’ recall does not scale in straightforward proportion to the space an ad takes up.",
      "cite": 8
    },
    {
      "text": "Type, imagery, placement, and where repeated exposures occur can change the outcome.",
      "cite": 13
    }
  ],
  "caveats": [
    {
      "text": "The experiment tests immediate written recall under controlled viewing conditions; it does not measure later purchases.",
      "cite": 10
    }
  ],
  "sections": [
    {
      "title": "Why remember an advertisement?",
      "start": 1
    },
    {
      "title": "Measuring size and repetition",
      "start": 8
    },
    {
      "title": "What the experiment leaves open",
      "start": 13
    }
  ]
}$sample$::jsonb, $sample$[
  {
    "id": "example:effects-of-advertisements:1",
    "articleId": "effects-of-advertisements",
    "action": "ask",
    "question": "How could an ad be memorable without doing its job?",
    "anchor": {
      "start": {
        "b": "p4",
        "o": 265
      },
      "end": {
        "b": "p4",
        "o": 367
      },
      "quote": "with the expectation that we keep the content of the advertisement in our memory for a later purchase."
    },
    "turns": [
      {
        "role": "assistant",
        "content": "A striking ad can leave a vivid image while the reader forgets the product or who made it. Münsterberg distinguishes attention and memory from the later purchase; he also asks whether illustrations draw attention away from the name and the object. A useful test needs to measure what the reader remembers. [¶4] [¶10] [¶13]"
      }
    ],
    "createdAt": 0
  },
  {
    "id": "example:effects-of-advertisements:2",
    "articleId": "effects-of-advertisements",
    "action": "ask",
    "question": "If you reused this experiment today, what could it tell you about repeat exposure?",
    "anchor": {
      "start": {
        "b": "p10",
        "o": 341
      },
      "end": {
        "b": "p10",
        "o": 466
      },
      "quote": "immediately after that every one had to write down what he remembered, both the names of the firms and the article announced."
    },
    "turns": [
      {
        "role": "assistant",
        "content": "By controlling view time and the number of exposures, the design can compare how repetition affects immediate recall across the ads shown. It cannot tell you how much people remember after a week or whether they buy. To answer those questions you’d need delayed measurement or a purchase outcome. [¶9] [¶10] [¶13]"
      }
    ],
    "createdAt": 0
  }
]$sample$::jsonb),
  ('laws-of-habit', $sample${
  "gist": "James sees habit as the route by which practice makes effortful actions nearly automatic. He asks teachers to set up conditions for a strong start and help pupils act on their resolutions while concrete opportunities are available.",
  "claims": [
    {
      "text": "Practiced actions become easier and require less conscious attention.",
      "cite": 3
    },
    {
      "text": "Automating useful routines can free attention for other work.",
      "cite": 6
    },
    {
      "text": "James advises acting at the first real opportunity so a resolution becomes a practiced behavior.",
      "cite": 11
    }
  ],
  "caveats": [
    {
      "text": "James acknowledges that dramatic reversals of longstanding habits do occur, even though his maxims emphasize gradual training.",
      "cite": 23
    }
  ],
  "sections": [
    {
      "title": "How an action becomes automatic",
      "start": 1
    },
    {
      "title": "How to start and sustain a habit",
      "start": 7
    },
    {
      "title": "When habits change suddenly",
      "start": 23
    }
  ]
}$sample$::jsonb, $sample$[
  {
    "id": "example:laws-of-habit:1",
    "articleId": "laws-of-habit",
    "action": "ask",
    "question": "How can habit make us both more free and less free?",
    "anchor": {
      "start": {
        "b": "p6",
        "o": 74
      },
      "end": {
        "b": "p6",
        "o": 128
      },
      "quote": "make our nervous system our ally instead of our enemy."
    },
    "turns": [
      {
        "role": "assistant",
        "content": "A useful routine frees you from deciding and concentrating on every small step. The same efficiency can lock in an unwanted response if that is what you have repeatedly practiced. James’s key question is which actions you hand over to habit in the first place. [¶3] [¶5] [¶6]"
      }
    ],
    "createdAt": 0
  },
  {
    "id": "example:laws-of-habit:2",
    "articleId": "laws-of-habit",
    "action": "ask",
    "question": "Why does James care so much about acting soon after making a resolution?",
    "anchor": {
      "start": {
        "b": "p11",
        "o": 50
      },
      "end": {
        "b": "p11",
        "o": 231
      },
      "quote": "Seize the very first possible opportunity to act on every resolution you make, and on every emotional prompting you may experience in the direction of the habits you aspire to gain."
    },
    "turns": [
      {
        "role": "assistant",
        "content": "An intention can feel like progress without giving you any practice at the desired action. James thinks the first concrete occasion is when you can start training the response, particularly by setting up conditions that make it easier to repeat. [¶7] [¶11] [¶12]"
      }
    ],
    "createdAt": 0
  }
]$sample$::jsonb),
  ('ebbinghaus-memory', $sample${
  "gist": "Ebbinghaus describes memory as a way present impressions bring earlier experiences back into play. What comes to mind depends on context and recency, while distributing practice across time can help the material stick.",
  "claims": [
    {
      "text": "Memory extends a response beyond what is immediately present.",
      "cite": 1
    },
    {
      "text": "The mental context just before a cue can determine which association it brings back.",
      "cite": 6
    },
    {
      "text": "Forgetting is described as rapid at first and slower later.",
      "cite": 8
    },
    {
      "text": "The author recommends spacing attentive repetitions rather than massing them together.",
      "cite": 9
    }
  ],
  "caveats": [
    {
      "text": "His broad advice on learning whole passages should not be read as evidence that every kind of material benefits from the same method.",
      "cite": 10
    }
  ],
  "sections": [
    {
      "title": "How experiences return",
      "start": 1
    },
    {
      "title": "What steers recall",
      "start": 5
    },
    {
      "title": "Forgetting and repetition",
      "start": 8
    }
  ]
}$sample$::jsonb, $sample$[
  {
    "id": "example:ebbinghaus-memory:1",
    "articleId": "ebbinghaus-memory",
    "action": "ask",
    "question": "In the railway metaphor, what is the equivalent of moving the switch?",
    "anchor": {
      "start": {
        "b": "p6",
        "o": 194
      },
      "end": {
        "b": "p6",
        "o": 278
      },
      "quote": "the position which was given to the switches immediately before the train’s arrival."
    },
    "turns": [
      {
        "role": "assistant",
        "content": "It’s what you were thinking about just before the cue. In conversation, the language you’re already using can make a particular association more likely. The same stimulus can lead to different recollections because it arrives in a different mental context. [¶4] [¶6]"
      }
    ],
    "createdAt": 0
  },
  {
    "id": "example:ebbinghaus-memory:2",
    "articleId": "ebbinghaus-memory",
    "action": "ask",
    "question": "What would you change about a study session if you took this paragraph seriously?",
    "anchor": {
      "start": {
        "b": "p9",
        "o": 0
      },
      "end": {
        "b": "p9",
        "o": 170
      },
      "quote": "The most important factor contributing toward certainty of reproduction is frequent repetition, of course with attention, for without attention no memorizing is possible."
    },
    "turns": [
      {
        "role": "assistant",
        "content": "Keep the same material and total practice time, but distribute the repetitions across sessions instead of going straight through the entire set at once. Ebbinghaus also singles out attention: spacing won’t help much if the later passes are only a blur of familiar words. [¶9]"
      }
    ],
    "createdAt": 0
  }
]$sample$::jsonb),
  ('relativity-of-simultaneity', $sample${
  "gist": "Einstein gives distant simultaneity a procedure: use light signals and clocks synchronized in a specified reference frame. A lightning example shows that events simultaneous for the embankment can be assigned different times in the moving train’s frame.",
  "claims": [
    {
      "text": "An observer midway between two points can compare the arrival times of light flashes.",
      "cite": 3
    },
    {
      "text": "The same synchronization rule lets a reference frame assign times to events at different places.",
      "cite": 8
    },
    {
      "text": "Simultaneity of the two distant strikes depends on the reference frame.",
      "cite": 13
    }
  ],
  "caveats": [
    {
      "text": "The example concerns events at different locations; it does not imply that all observers disagree on the order of all events.",
      "cite": 12
    }
  ],
  "sections": [
    {
      "title": "Defining simultaneity",
      "start": 1
    },
    {
      "title": "Synchronizing clocks",
      "start": 8
    },
    {
      "title": "Changing reference frames",
      "start": 10
    }
  ]
}$sample$::jsonb, $sample$[
  {
    "id": "example:relativity-of-simultaneity:1",
    "articleId": "relativity-of-simultaneity",
    "action": "ask",
    "question": "Why does Einstein spend time defining simultaneity before discussing the train?",
    "anchor": {
      "start": {
        "b": "p7",
        "o": 237
      },
      "end": {
        "b": "p7",
        "o": 331
      },
      "quote": "an empirical decision as to whether or not the conception that has to be defined is fulfilled."
    },
    "turns": [
      {
        "role": "assistant",
        "content": "To compare times at different places you need a rule for synchronizing distant clocks. The midpoint procedure supplies that rule in one frame. Without it, saying two strikes were simultaneous sounds intuitively clear but doesn’t say what observations would decide the question. [¶2] [¶3] [¶7] [¶8]"
      }
    ],
    "createdAt": 0
  },
  {
    "id": "example:relativity-of-simultaneity:2",
    "articleId": "relativity-of-simultaneity",
    "action": "ask",
    "question": "Is the train’s result just an optical illusion caused by the time light takes to reach the observer?",
    "anchor": {
      "start": {
        "b": "p12",
        "o": 498
      },
      "end": {
        "b": "p12",
        "o": 573
      },
      "quote": "it moves towards the right in the diagram with the velocity v of the train."
    },
    "turns": [
      {
        "role": "assistant",
        "content": "The arrival times matter, but the disagreement remains when each frame uses its own synchronized clocks. The train observer moves toward one flash and away from the other in the embankment description. In the train frame, the observer sits midway between the strike locations and the light travels at the same speed in either direction, so different arrivals imply different strike times. [¶12] [¶13]"
      }
    ],
    "createdAt": 0
  }
]$sample$::jsonb),
  ('newton-on-colour', $sample${
  "gist": "Newton finds that an isolated band of colored light keeps its color through another refraction, while several bands can recombine to make white light. He tests the difference with prisms, a lens, and by blocking individual parts of the spectrum.",
  "claims": [
    {
      "text": "Further refraction changes the direction of a narrow band without visibly changing its color.",
      "cite": 3
    },
    {
      "text": "A lens can reunite separated rays at a focus where their mixture looks white.",
      "cite": 11
    },
    {
      "text": "Removing a component before recombination removes that same component when the white-looking beam is dispersed again.",
      "cite": 14
    }
  ],
  "caveats": [
    {
      "text": "Newton acknowledges that his narrow bands are not perfectly homogeneous; any residual color change is below what he can see.",
      "cite": 3
    }
  ],
  "sections": [
    {
      "title": "Testing individual colors",
      "start": 1
    },
    {
      "title": "Recombining the spectrum",
      "start": 8
    },
    {
      "title": "Tracking colors through the mixture",
      "start": 12
    }
  ]
}$sample$::jsonb, $sample$[
  {
    "id": "example:newton-on-colour:1",
    "articleId": "newton-on-colour",
    "action": "ask",
    "question": "Why send an already separated color through another prism?",
    "anchor": {
      "start": {
        "b": "p3",
        "o": 339
      },
      "end": {
        "b": "p3",
        "o": 436
      },
      "quote": "If any Part of the red Light was refracted, it remained totally of the same red Colour as before."
    },
    "turns": [
      {
        "role": "assistant",
        "content": "The second refraction lets Newton vary the bending while keeping the input close to one color. If bending created colors by itself, he could expect fresh colors to appear. The band changes direction but stays red to the eye, which supports separation of colors already present in the original beam. [¶2] [¶3]"
      }
    ],
    "createdAt": 0
  },
  {
    "id": "example:newton-on-colour:2",
    "articleId": "newton-on-colour",
    "action": "ask",
    "question": "What does blocking red before recombination prove that simply making white light doesn’t?",
    "anchor": {
      "start": {
        "b": "p14",
        "o": 355
      },
      "end": {
        "b": "p14",
        "o": 472
      },
      "quote": "the red at r will accordingly disappear, and return as often, but the violet at v will not thereby suffer any Change."
    },
    "turns": [
      {
        "role": "assistant",
        "content": "The white spot alone shows only what the combined light looks like. Newton disperses that mixture again and sees the red region vanish when he blocks red upstream, while the violet remains. The experiment tracks a component through the mixture and shows that looking white does not erase the individual contributions. [¶11] [¶14]"
      }
    ],
    "createdAt": 0
  }
]$sample$::jsonb);
