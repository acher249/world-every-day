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
text, and plans art direction with the selected managed Gemini, Bedrock Nova,
or Vertex Claude adapter, not a self-hosted model. Google image generation
still receives an authored visual prompt with story-derived physical details. See the
[data boundary](../DATA_BOUNDARY.md). The development workers use this route.

## Enabled reference feeds

The reference configuration and AWS development deployment have 32 sources:
31 RSS feeds and one Atom feed.

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

The October 2026 review kept the Library of Congress out of scope. NSF's
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

## Live validation record

On 2026-10-13, all 16 enabled feeds completed a live collection pass. A 24-hour
window produced 54 candidates, which were evaluated and reduced to a factual
ten-story test edition spanning health, education, housing, space, civic
governance, language, and ecological art. Permitted articles were read
ephemerally and only project-authored evidence artifacts were retained.

The run also tightened the source boundary. NPR was discovery-only in that
test and is not enabled now. The Conversation's Atom feed was removed when an
earlier RSS-only configuration was adopted. Smithsonian returned HTTP 403 for
an article request and UN News feed links did not expose a readable article
body, so neither is enabled now.
An early Global Voices extraction selected a promotional card instead of the
main entry; the artifacts were rejected, the extractor was corrected and
regression-tested, and the two pages were reprocessed successfully.

These observations are operational checks, not permanent guarantees. Source
behavior and terms must be monitored and re-reviewed.

On 2026-10-15, the local reference allowlist changed from 16 mixed RSS/Atom
feeds to 19 RSS feeds. NSF, NCI, NOAA National Ocean Service, and Yale News were
added for ephemeral article analysis; The Conversation's Atom feed was removed.
The [NSF](https://www.nsf.gov/policies/digital),
[NCI](https://www.cancer.gov/policies/copyright-reuse), and
[NOAA](https://oceanservice.noaa.gov/about/faq.html) sites publish text-reuse
guidance. Yale's official
RSS feed links to multiple university subdomains, so only `news.yale.edu`
articles enter discovery. The new host filter applies to every configured
source. These are local changes, not an AWS deployment. Feed and article access
must be rechecked before deployment; adding them does not guarantee a
ten-story daily edition. NCI's news-release feed was reachable but its latest
entry in this check was from May 2026, so its expected daily yield is low.

A read-only local collection over a 36-hour October 14–16 window completed all
19 feeds with no failures and returned 62 candidates. Of the four newly enabled
sources, only Yale contributed an in-window candidate, on the reviewed
`news.yale.edu` host. NSF, NCI, and NOAA had no in-window entries. This run
did not call an editorial model or deploy the configuration.

The next local review added Wikimedia Diff as discovery-only. Its official RSS
feed responded successfully and its robots file did not restrict article or feed
paths. The remaining proposed feeds are not enabled: USDA Rural Development and
IRENA returned HTTP 403; FAO's tested feed URL did not resolve to a usable feed;
the USDA ARS feed returns HTTP article links that fail this project's HTTPS-only
policy; and EEA's robots file disallows its `*/rss.xml` paths despite its public
RSS directory. These are current access observations, not judgments about the
publishers. Wikimedia's community posts may carry per-item rights or
attribution considerations, so full-article analysis remains off pending review.

The subsequent source-policy review removed Positive News, Reasons to be
Cheerful, and Next City entirely. Earlier local test artifacts may still cite
them; the current configuration does not fetch their feeds. The 17-source
version was deployed to the development AWS stack. A 24-hour manual run on
October 16 collected 46 candidates from all 17 feeds without source failures;
only four passed the current shortlist and article-access rules. That is a
technical validation, not an approved daily edition.

An earlier deployed reference configuration had 24 feeds. [Horizon Magazine's reuse
policy](https://projects.research-and-innovation.ec.europa.eu/en/horizon-magazine/republish-our-stories)
offers its articles under CC BY 4.0; its official RSS, article pages, and robots
policy were checked. [Cornell Chronicle](https://news.cornell.edu/rss-feeds)
publishes official topic RSS feeds; its article and robots access were checked. Cornell's
[copyright notice](https://news.cornell.edu/about/copyright) permits text
excerpts in news media but restricts redistribution of photographs and graphics;
this project does not copy those assets. ESA's official feed is enabled only
for discovery while article-use terms remain unresolved. These are source-use
assessments, not legal clearance, and should be re-reviewed before deployment.
The same 24-hour window yielded 48 candidates with no feed failures, but the
only in-window addition was an ESA discovery-only entry. Broader feed coverage
alone did not resolve the ten-story gap in that window; selection quality and
source freshness still need evaluation. Those additions were deployed on
October 18 alongside the PLOS feeds.
Berkeley News was considered but excluded: its article links currently redirect
through HTTP, which the project's HTTPS-only fetcher correctly refuses.

### Higher-volume feeds

[PLOS ONE](https://journals.plos.org/plosone/s/help-using-this-site) offers a
journal-hosted RSS feed at `https://journals.plos.org/plosone/feed/rss`.
[PLOS Global Public Health](https://journals.plos.org/globalpublichealth/)
offers the same format at `https://journals.plos.org/globalpublichealth/feed/rss`.
In the October 16 test window, these feeds supplied 30 and three entries,
respectively; adding both to the local collector produced 80 candidates total
with no feed failures. A sampled linked article was readable by the bounded
extractor, and [PLOS's article policy](https://journals.plos.org/plosone/s/licenses-and-copyright)
generally permits reuse under CC BY 4.0. This measures discovery volume, not
editorial quality: the feeds also contain corrections and specialized papers.

PLOS is enabled in the deployed development stack. Its
[robots policy](https://journals.plos.org/robots.txt) specifies a
30-second crawl delay. The AWS collector and article workers reserve requests
atomically in DynamoDB by hostname; local tools pace requests across one
process. The collector admits at most 100 candidates using a publisher-balanced
round robin and records the number omitted. Simultaneous independent local
processes are not coordinated, so operators should not run them against PLOS
at the same time. An October 18 AWS rerun of the October 15–16 window found
69 candidates, no feed failures, and nine metadata-shortlisted stories. Four
shortlisted stories came from PLOS. This is not a publication-quality edition:
article evidence was not fetched, and metadata-level selection still admits
some routine or highly specialized items. The daily schedule was disabled at
the time of that test.
For the October 17–18 7:30 a.m. Pacific window, a discovery-only AWS run found
19 links without feed failures, but only three were from article-analysis-
approved sources; 12 NPR and four Wikimedia Diff links remained discovery-only.
This is a source-policy and weekend-coverage gap, not a basis for relaxing
article-use rules. A ten-window retrospective using current RSS snapshots is
incomplete for older dates because feeds roll over; prospective daily snapshots
are needed for a reliable yield estimate.

[eLife](https://elifesciences.org/alerts) supplied six in-window research
entries in a read-only RSS check, but its linked article returned a client
challenge to the pipeline's fetcher. It remains excluded rather than bypassing
that access control.

### Local source-policy revision, pending deployment

After the October 18 scheduled test produced one published story, the default
configuration was reduced from 24 feeds to 19: six discovery-only feeds were
removed and FDA press releases were added. In that test, 15 of 18 in-window
candidates came from discovery-only feeds and could not proceed to article
analysis. The revised local default therefore collects only sources that can
enter the full pipeline. It has not yet been deployed or shown to produce ten
eligible stories per day. FDA's official feed and a sample HTTPS article were
reachable during review, but its volume is low. The remaining source policies,
robots directives, delivery behavior, and any per-page third-party notices
must continue to be checked; this review is not legal advice or a guarantee
that every linked item is usable.

The next local revision widened MIT Research News to MIT Latest News and
replaced three narrow Cornell topic feeds with its general news-and-events feed.
Both official feeds were reachable and each exposed 50 entries on October 18;
MIT's latest entry was published that Sunday. NOAA's general feed and a linked
article were reachable over HTTPS, and its [public-use guidance](https://www.noaa.gov/office-education/outreach-communication/faq)
covers most NOAA-authored content, with exceptions for third-party material.
PLOS Medicine's official feed was also reachable and its article links use the
already-reviewed PLOS host and [open article terms](https://plos.org/terms-of-use/).
These two additions and two wider feeds leave the local default at 19 sources.
PLOS Climate and PLOS Sustainability feeds were reachable but their newest
entries were six and nine days old in this check, so they were not enabled as
a way to improve daily yield. The advertised National Archives news feed was
stale since 2021, and its blog feed redirected to an archive challenge; neither
was enabled. This is a read-only source validation, not a live publication test
or deployment.

Two read-only collections with the revised 19-feed list had no feed failures.
An October 15–16 weekday window returned 53 links, including 30 from PLOS ONE,
four from MIT Latest News, and one from PLOS Medicine. An October 18–19 Sunday
window returned only three: one each from Global Voices, NASA, and MIT Latest
News. These are discovery counts, not fact-checked or editorially eligible
stories. The weekday mix remains research-heavy, and adding feeds alone has not
solved the weekend ten-story target. A longer editorial lookback or additional
permission-cleared sources that publish on weekends would require separate
product and source-policy review.

The next local revision added FAO Newsroom, bringing that version of the default to 20
feeds. [FAO's terms](https://www.fao.org/contact-us/terms/) expressly
encourage reuse of its news releases. Its official newsroom RSS returned 22
items with `www.fao.org/newsroom/detail/` links, and its robots rules did not
exclude the feed or article paths. This review concerns FAO-authored newsroom
releases, not third-party media or every kind of FAO content; the project still
stores no article text. Rhinoceros Media was also evaluated, but its narrow
local focus and infrequent updates make it a better optional source for a
regional fork than for the worldwide reference edition. This is an editorial
fit decision, not a licensing objection. No deployment or paid article
analysis was performed in this review.

A 21-feed live collection check before removing Rhinoceros Media completed
without feed failures: FAO's feed parsed 22 links and Rhinoceros Media's smaller
feed parsed eight. In the October 18–19 24-hour window used for that check,
neither contributed an in-window item, and the full list produced one link.
This was a feed-collection check only; no linked article was analyzed by a paid
model.

### Geographic-scope review

The reference edition may include consequential developments within one country,
including domestic US news. A publisher's location is not an eligibility rule.
The previous 20-feed local default included Global Voices, WHO, UNESCO-UNEVOC, FAO, and
PLOS have international coverage; NASA and NOAA report space, Earth, climate,
and ocean science; NSF, NCI, FDA, and NIST supply US science, health, and
regulatory developments; Horizon covers EU-funded research; and Yale, Harvard,
Cambridge, MIT, and Cornell report institutional research and other news.

The general university feeds can also contain campus or local updates. The
editorial prompt asks the model to reject routine administrative items without
a substantive new development, regardless of country. It does not reject a
story merely for being domestic. This judgment still needs review; inclusion
on the source allowlist does not qualify every item for an edition.

An October 18 read-only rerun of that 20-feed local configuration found
three links in the latest completed 24-hour publication window and 12 in a
48-hour window ending at the same time. All feeds succeeded. The longer window
included routine NASA image posts, an appointment, and institutional updates;
these discovery totals are **not** counts of editorially eligible stories.
Neither window establishes a reliable seven-story minimum. The configuration
has not been deployed, and no paid analysis or publication was performed.

Earlier source review did not justify another default addition at the time.
[UNDP's terms](https://www.undp.org/copyright-terms-use) restrict site-material
use to personal, non-commercial purposes absent other permission, and
[UNICEF requests permission](https://www.unicef.org/legal) for wider reuse.
[Agência Brasil's current reproduction policy](https://agenciabrasil.ebc.com.br/sobre)
addresses journalistic outlets and asks users to contact its licensing team for
commercial uses, so older Creative Commons references are not enough to clear
this installation's intended use. GOV.UK's update-only Atom dates previously
blocked inclusion; the new local adapter now verifies first-publication dates
through the official Content API and admits only news documents. The
[European Commission's highlighted-news feed](https://commission.europa.eu/news-and-media/highlighted-news_en)
has clear [reuse terms](https://commission.europa.eu/legal-notice_en) but is too
infrequent to materially address the daily-yield gap. These decisions can be
revisited; they are not claims that the sources are categorically unusable.

### Ten-feed expansion, deployed October 19

The preceding deployed allowlist had **30 RSS feeds**. Ten were added after the
20-feed test: NSF science and engineering statistics, European Commission
highlighted news, CDC *Emerging Infectious Diseases* ahead-of-print articles,
and seven PLOS journals listed above. The additions do not establish a
reliable daily shortlist. Seven feeds share PLOS's publisher
and its 30-second host-wide crawl delay. All ten PLOS journals share one
publisher group for diversity limits; they broaden research topics but do not
by themselves add independent reporting or solve weekend coverage.

Each added feed returned RSS with linked HTTPS articles on the configured host.
The NSF feed uses `publishDate`, now accepted by the parser; a linked report was
readable. A CDC EID article and European Commission article were readable by the
bounded in-memory extractor, as was a sampled PLOS Water article. The CDC EID
[usage policy](https://wwwnc.cdc.gov/eid/page/copyright-and-disclaimers)
permits use with proper citation; [NSF's text policy](https://www.nsf.gov/policies/digital),
the [Commission's CC BY 4.0 notice](https://commission.europa.eu/legal-notice_en),
and [PLOS's journal-wide license policy](https://journals.plos.org/plosone/s/licenses-and-copyright)
support the same limited, cited, ephemeral analysis boundary. Third-party
materials, marks, and images are not copied. Robots directives were reviewed;
CDC EID requests 20-second pacing and PLOS requests 30 seconds. This is a
source-policy assessment, not a legal guarantee for every future item.

The October 19 source-expansion test ran the full unattended AWS workflow with
the subsequent 32-source configuration. Its 24-hour window yielded 35
in-window candidates, including 15 from GOV.UK and two from Commission
environment news. Nine stories were selected, and a public test preview was
generated with nine baked story interactions and three echoes, then promoted
to the current edition without another generation. FDA's feed
returned HTTP 404 and PLOS ONE returned HTTP 503 in that run; both failures
were isolated. These are observations from one window, not a guaranteed daily
yield or proof that every future article has identical reuse terms.

The main NIH release feeds returned HTTP 403, and NIBIB's robots file disallows
all paths, so none were enabled. The extra Commission feed is low-frequency; it
adds subject breadth, not a promised daily volume. The larger PLOS set can make
the collection stage take roughly five minutes, so the local CDK definition
allows seven minutes. Candidate admission remains capped at 100 before any
paid editorial request. A read-only run on October 18 succeeded for all 30
feeds, but the sampled weekend window still returned the same three candidates
as the 20-feed mix. No paid editorial run was made for that sample. The expanded
allowlist was deployed October 19. Prospective daily collection and editorial-
yield measurement remain necessary; an enabled schedule does not prove ten-story
coverage.

The first 30-feed AWS execution for the October 19 window discovered six
in-window candidates, with one FDA feed failure. Editorial analysis shortlisted
one CDC research article, which became a public one-story edition. The FDA RSS
URL later returned HTTP 200 in a direct check; its failure is isolated, not yet
diagnosed as a permanent source change.
