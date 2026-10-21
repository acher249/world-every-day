# Source policy

The reference implementation uses a reviewed allowlist of RSS and Atom feeds.
We make a good-faith effort to check each source's access and reuse terms,
robots directives, and request limits before enabling it. A feed or public
article URL is not blanket permission to use its content. The default list
contains sources reviewed for bounded, ephemeral article analysis; source text
is processed in memory and discarded. The pipeline keeps links, checksums, and
original project summaries, not article copies or verbatim passages.
Source policies can change, so operators should recheck them periodically.

The current repository code evaluates feed metadata, analyzes permitted article
text, and plans art direction with the selected managed Gemini or Bedrock Nova
adapter, not a self-hosted model. Google image generation
still receives an authored visual prompt with story-derived physical details. See the
[data boundary](../DATA_BOUNDARY.md). The development workers use this route.

## Enabled reference feeds

The reference configuration and AWS development deployment have 32 sources:
31 RSS feeds and one Atom feed.
They span reporting, research journals, university newsrooms, and public
institutions. The current mix often favors science, health, and technology;
editions are curated perspectives, not comprehensive daily news digests.

| Source | Role | Article access | Coverage |
| --- | --- | --- | --- |
| [NASA News](https://www.nasa.gov/rss-feeds/) | Primary | Ephemeral analysis | Space, Earth science, and exploration |
| [NSF News](https://www.nsf.gov/rss) | Primary | Ephemeral analysis | Science, engineering, education, and society |
| [NSF science and engineering statistics](https://ncses.nsf.gov/rss) | Primary | Ephemeral analysis | Research, workforce, and innovation statistics |
| [National Cancer Institute](https://www.cancer.gov/syndication/rss) | Primary | Ephemeral analysis | Cancer research and public health |
| [FDA press releases](https://www.fda.gov/about-fda/contact-fda/subscribe-podcasts-and-news-feeds) | Primary | Ephemeral analysis | Public health, medical products, and food safety |
| [NOAA National Ocean Service](https://oceanservice.noaa.gov/rss.html) | Primary | Ephemeral analysis | Oceans, coasts, and conservation |
| [NOAA News](https://www.noaa.gov/rss-feeds) | Primary | Ephemeral analysis | Climate, weather, oceans, and environmental research |
| [Yale News](https://news.yale.edu/rss-feeds) | Institutional reporting | Ephemeral analysis, `news.yale.edu` only | Culture, environment, health, and research |
| [Global Voices](https://globalvoices.org/feed/) | Reporting | Ephemeral analysis | Languages, culture, civic life, and communities |
| [WHO News](https://www.who.int/rss-feeds/news-english.xml) | Primary | Ephemeral analysis | International public health |
| [UNESCO-UNEVOC](https://connect.unevoc.unesco.org/home/rss-feed) | Primary | Ephemeral analysis | Education, skills, and work |
| [FAO Newsroom](https://www.fao.org/newsroom/en/) | Primary | Ephemeral analysis | Food systems, agriculture, forests, and communities |
| [European Commission highlighted news](https://commission.europa.eu/news-and-media/highlighted-news_en) | Primary | Ephemeral analysis, `commission.europa.eu` only | European public initiatives and cooperation |
| [European Commission environment news](https://environment.ec.europa.eu/news_en) | Primary | Ephemeral analysis, `environment.ec.europa.eu` only | Environment, biodiversity, and climate action |
| [GOV.UK news](https://www.gov.uk/search/news-and-communications) | Primary | Ephemeral analysis, `www.gov.uk` only | Public services, health, climate, communities, and research |
| [CDC Emerging Infectious Diseases](https://wwwnc.cdc.gov/eid/page/rss-feeds) | Primary research | Ephemeral analysis, paced 20 seconds per host | Infectious-disease research and public health |
| [Harvard Gazette](https://news.harvard.edu/gazette/feed/) | Institutional reporting | Ephemeral analysis | Health, education, culture, and research |
| [University of Cambridge News](https://www.cam.ac.uk/news/feed) | Institutional reporting | Ephemeral analysis | Health, culture, and research |
| [MIT Latest News](https://news.mit.edu/rss) | Institutional reporting | Ephemeral analysis | Research, technology, culture, and community |
| [NIST News](https://www.nist.gov/coo/nist-rss-feeds) | Primary | Ephemeral analysis | Standards, measurement, and applied science |
| [Horizon Magazine](https://projects.research-and-innovation.ec.europa.eu/en/horizon-magazine/republish-our-stories) | Institutional reporting | Ephemeral analysis | European research, social innovation, health, and environment |
| [Cornell Chronicle news and events](https://news.cornell.edu/rss-feeds) | Institutional reporting | Ephemeral analysis, `news.cornell.edu` only | Culture, agriculture, health, research, and communities |
| [PLOS ONE](https://journals.plos.org/plosone/s/help-using-this-site) | Primary research | Ephemeral analysis, paced 30 seconds per host | Broad peer-reviewed research |
| [PLOS Global Public Health](https://journals.plos.org/globalpublichealth/) | Primary research | Ephemeral analysis, paced 30 seconds per host | Public-health research |
| [PLOS Medicine](https://journals.plos.org/plosmedicine/) | Primary research | Ephemeral analysis, paced 30 seconds per host | Health research and care |
| [PLOS Biology](https://journals.plos.org/plosbiology/) | Primary research | Ephemeral analysis, paced 30 seconds per host | Biological research |
| [PLOS Computational Biology](https://journals.plos.org/ploscompbiol/) | Primary research | Ephemeral analysis, paced 30 seconds per host | Computational and biological research |
| [PLOS Climate](https://journals.plos.org/climate/) | Primary research | Ephemeral analysis, paced 30 seconds per host | Climate research |
| [PLOS Digital Health](https://journals.plos.org/digitalhealth/) | Primary research | Ephemeral analysis, paced 30 seconds per host | Health technology and care |
| [PLOS Neglected Tropical Diseases](https://journals.plos.org/plosntds/) | Primary research | Ephemeral analysis, paced 30 seconds per host | Global infectious-disease research |
| [PLOS Sustainability and Transformation](https://journals.plos.org/sustainabilitytransformation/) | Primary research | Ephemeral analysis, paced 30 seconds per host | Sustainability research |
| [PLOS Water](https://journals.plos.org/water/) | Primary research | Ephemeral analysis, paced 30 seconds per host | Water systems and access |

The machine-readable allowlist is
`pipeline/config/source-configuration.initial.v1.json`. Adding or changing a
source requires reviewing its feed documentation, article-access terms, robots
directives, host and redirect behavior, publication metadata, and editorial
role. Custom configurations may still use `discovery-only`, but those links do
not enter the full edition workflow.

GOV.UK's Atom feed reports update times, so its adapter verifies each news
entry's original publication date with the [official Content API](https://content-api.publishing.service.gov.uk/)
before admitting it. It excludes non-news documents and withdrawn items. The
API response is processed ephemerally; only the publication date and candidate
metadata persist. [GOV.UK reuse terms](https://www.gov.uk/help/reuse-govuk-content)
and the [European Commission legal notice](https://commission.europa.eu/legal-notice_en)
allow reuse of their own material subject to stated exceptions and attribution.
These additions do not override per-page rights notices or justify copying
third-party images or text into published editions.

[OpenAlex](https://help.openalex.org/api/) and
[PMC / Europe PMC](https://pmc.ncbi.nlm.nih.gov/tools/openftlist/) remain
candidate research integrations, not enabled sources. OpenAlex indexes metadata
but does not grant rights to linked full text; PMC open-access articles have
different per-item licenses and require approved retrieval APIs. We will add a
research adapter only when it can verify each article's license and retrieve
permitted full text through an official API before admitting a candidate.

UN News, NPR, Smithsonian Magazine, Wikimedia Diff, and ESA Earth observation
were removed from the default feed list. They remain potential sources only if
article-analysis permissions and access can be established; a public RSS feed
alone is not enough. In an earlier review, FDA's [site policy](https://www.fda.gov/about-fda/about-website/website-policies)
says its own site content is generally public domain unless otherwise noted and
prefers linking to current pages. Its official press-release feed is readable,
and the sampled linked page is served over HTTPS, although feed entries use
HTTP links. The FDA-specific adapter upgrades only allowlisted `www.fda.gov`
links to HTTPS before retrieval; it does not permit general HTTP fetching.
FDA press releases are relatively infrequent and may include routine regulatory
announcements, so this addition does not guarantee daily story volume or fit.

Positive News, Reasons to be Cheerful, and Next City are excluded from the
reference allowlist, including feed discovery, pending explicit permission or
another documented basis for the intended automated use. Their published
[terms](https://www.positive.news/terms-and-conditions/),
[AI policy](https://reasonstobecheerful.world/editorial-and-ethics-policy/),
and [terms](https://nextcity.org/terms), respectively, raise concerns for this
pipeline. A public feed or article URL alone is not permission to process its
contents. Other enabled sources still require periodic terms review; this
allowlist is not a legal clearance certificate.

## Reference boundary

The reference implementation discovers stories only through reviewed RSS and
Atom feeds. It does not depend on social feeds or unbounded website
collection. A feed entry supplies discovery metadata and a link; it does not by
itself grant permission to analyze or republish the linked page.

This is an implementation boundary, not a limit on the project. Contributors
may add adapters for APIs, datasets, archives, private knowledge bases, or other
information sources when they have permission to access and use them. Each
adapter must preserve provenance and document its access, analysis, retention,
and publication permissions.

## Candidate feed registry

The following official feeds are promising candidates for a broader source
mix. They are not enabled by this table. Each still requires a source-policy
review and a live validation before being added to the machine-readable
allowlist.

| Source | Editorial role | Coverage |
| --- | --- | --- |
| [DOE Office of Science](https://science.osti.gov/RSS) | Primary institution | Energy, computing, physics, climate |
| [CDC](https://www2c.cdc.gov/medialibrary/) | Primary institution | Public health and epidemiology |
| [USGS News](https://www.usgs.gov/news/news-releases/national-news-releases) | Primary institution | Earth science, water, hazards, ecosystems |
| [ESA](https://www.esa.int/Services/RSS_Feeds) | Primary institution | Space science and Earth observation |
| [European Commission Research and Innovation](https://research-and-innovation.ec.europa.eu/news/stay-connected_en) | Primary institution | European research and innovation |
| [WHO regional news](https://www.emro.who.int/rss-feeds.html) | Primary institution | Public health and international cooperation |
| [UNESCO World Heritage](https://whc.unesco.org/en/news/) | Primary institution | Culture, conservation, and communities |
| [Smithsonian Insider](https://insider.si.edu/rssfeeds/) | Institutional reporting | Science, nature, arts, and history |
| [ETH Zurich News](https://ethz.ch/content/main/en/utils/rss.html) | Institutional reporting | Science, engineering, climate, health |
| [eLife](https://elifesciences.org/alerts) | Open research | Life science and medicine |
| [USDA Rural Development](https://www.rd.usda.gov/newsroom/rss) | Primary institution | Rural communities and infrastructure |
| [European Environment Agency](https://www.eea.europa.eu/en/newsroom/rss-feeds) | Primary institution | Climate, environment, and ecosystems |
| [IRENA](https://www.irena.org/rssfeed) | Primary institution | Renewable energy |
| [USDA Agricultural Research Service](https://www.ars.usda.gov/news-events/rss-feeds/) | Primary institution | Farming and food research |

The Library of Congress is outside the current editorial scope. NSF's
official feed links to `/news/<story>` pages, which are outside its robots
exclusion for `/news/releases`; its text-reuse policy permits most NSF-authored
text. Smithsonian Insider and USGS returned HTTP 403 to feed
requests. ETH Zurich's published copyright terms need further review before
article text is sent to a hosted model. ESA offers a reachable Earth-observation
RSS feed, but its article-use terms have not yet been cleared for that step.
The DOE page lists feed categories, but an appropriate current news feed still
needs live validation. None of these candidates should be treated as enabled
or approved for article analysis.

University and institutional newsrooms report on their own organizations. They
are valuable direct sources, but consequential claims should also resolve to a
paper, dataset, trial record, public report, or independent corroborating
source. Selection should limit concentration from any one institution and
maintain a useful mix of subjects.

AP and Reuters do not currently provide a suitable general public feed for the
default configuration. Their licensed delivery products can be supported later
through optional adapters when an operator has the necessary agreement.

## Discovery and retrieval rules

- Fetch only configured HTTPS feed and article hosts.
- Use feeds for discovery; fetch full pages only after shortlisting.
- Keep requests bounded, infrequent, and identifiable.
- Do not bypass authentication, paywalls, access controls, or robots directives.
- Do not persist or publish article text or verbatim evidence passages.
- Treat failed or ambiguous sources as unavailable rather than weakening access
  controls.
- Re-review sources before production deployment and whenever their terms or
  delivery behavior changes.

This starter list tests the software, not the breadth or balance of the eventual
daily edition. A production source policy still needs broader subject coverage,
community sources, corroboration rules, corrections, and takedowns.

## Source review notes

- PLOS journals generally publish under [CC BY 4.0](https://journals.plos.org/plosone/s/licenses-and-copyright).
  All ten feeds count as one publisher group for editorial diversity. Requests
  share a 30-second host-wide delay; CDC EID uses 20 seconds.
- [Horizon](https://projects.research-and-innovation.ec.europa.eu/en/horizon-magazine/republish-our-stories)
  offers CC BY 4.0 articles. [Cornell](https://news.cornell.edu/about/copyright)
  permits text excerpts and reprints in news or information media, not blanket
  reuse of images. Do not assume university sources all share one license.
- [FAO](https://www.fao.org/contact-us/terms/) encourages reuse of its news
  releases. This review covers FAO-authored newsroom releases, not all FAO or
  third-party material.
- [NSF](https://www.nsf.gov/policies/digital),
  [NCI](https://www.cancer.gov/policies/copyright-reuse),
  [NOAA](https://www.noaa.gov/office-education/outreach-communication/faq), and
  [CDC EID](https://wwwnc.cdc.gov/eid/page/copyright-and-disclaimers) publish reuse
  guidance with exceptions. Preserve citations and check per-page notices.
- GOV.UK and European Commission feeds add public-interest coverage; their
  reuse terms and the GOV.UK date-verification behavior are described above.

The collector caps candidate admission at 100 before paid evaluation and
isolates feed failures. Feed volume is not a guarantee of eligible stories.
Research journals can include corrections or highly specialized papers, and
university feeds can include routine campus announcements. Editorial selection
filters for substantive developments rather than filling a quota.

Current feed snapshots roll over and cannot establish historical daily yield.
Monitor prospective runs, especially weekends, and re-review access failures
and source terms before changing the allowlist. Domestic stories, including
US developments, are eligible when consequential; publisher location alone is
not an eligibility rule.
