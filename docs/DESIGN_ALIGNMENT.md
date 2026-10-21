# Design alignment and supplied-asset provenance

## Sources reviewed

The source of truth is the user-supplied `NolyaV1.1` design archive, not a newly invented visual direction:

- `Nolya_Page04_Invite_Friends_China_Entry_v1_1/reference/Nolya_UI_Design_System_v1_0.md`: frozen Warm Editorial × Playful Social design system.
- `Nolya_Page01_Home_New_Ambassador_v2_0/Nolya_Page01_Home_UX_Implementation_Spec_v2_0.md`, supplied desktop/mobile PNGs, and `nolya_page01_zh-CN_v2_0.json`: Home hierarchy, copy, portrait collage, primary/secondary CTA, and three-step journey. Reference pixels were inspected, not inferred from filenames. The mobile PNG named zh-CN contains English lettering; live Chinese copy therefore follows the JSON.
- Page03 v1.1 source assets: the supplied standalone cafe and outdoor portraits, inspected visually.
- Page04 v1.1 source assets: both supplied desktop/mobile friend scenes, inspected visually.

## Implemented

- Restored Iris Purple `#6B57FF`, deep purple `#4E3DF2`, lavender `#EAE4FF`, peach `#FFB88A`, ink `#171531`, warm canvas, and line color `#E8E4F2` as explicit tokens.
- Retained darker functional-text variants for WCAG contrast on tinted cards. Decorative brand purple and white-on-purple primary buttons use the original brand. This is an accessibility accommodation rather than an alternate palette.
- Restored bold sans-serif wordmark, PingFang-first Chinese font stack, larger headings and body copy, 22px buttons, 28px cards, and 20px mobile gutters. Removed fixed font sizes below 13px across existing product flows, not only Home.
- Replaced the abstract CSS cartoon Home hero with the actual latest Page01 v2 composite artwork region, including the new ambassador, blended spring background, and all three original floating photo cards. An accessible label identifies the artwork as illustrative, not a testimonial. The initial Page03 cafe substitution was rejected and removed.
- Home uses the supplied Chinese v2 locale for headline, supporting copy, actions, benefits, and three steps. No screenshot is embedded as the entire functional interface. Navigation and daily-choice functionality remain live.
- Added Page04 editorial layout styles: desktop text-left/photo-right, mobile scene-first, benefit/context chips, and stacked mobile journey steps. Page04 uses its actual supplied friend-scene images rather than the old abstract bubbles.
- Retained keyboard focus, reduced-motion support, existing navigation safe areas, and high-contrast semantic text.

## Asset inventory and rights boundary

All six images are unchanged copies of user-supplied design-reference assets; no third-party photo search or external image host is introduced.

| Public asset | Original package-relative source |
| --- | --- |
| `design/ambassador-cafe.jpg` | `Nolya_Page03_Self_Result_China_Entry_v1_1/source/assets/shan_young_cafe_main_v1_0.jpg` |
| `design/ambassador-outdoor.jpg` | `Nolya_Page03_Self_Result_China_Entry_v1_1/source/assets/shan_young_outdoor_insert_v1_0.jpg` |
| `design/invite-desktop.png` | `Nolya_Page04_Invite_Friends_China_Entry_v1_1/source/assets/page04_approved_friend_scene_desktop.png` |
| `design/invite-mobile.png` | `Nolya_Page04_Invite_Friends_China_Entry_v1_1/source/assets/page04_approved_friend_scene_mobile.png` |
| `design/guess-outdoor.png` | `Nolya_Page09_Guess_Me_China_Entry_v1_1/source/assets/approved_young_ambassador_outdoor.png` |

The filenames' word “approved” refers to the supplied design package, not independently verified commercial clearance. No commercial license grant or model release was found in the reviewed package README/reference/spec files. A Page03 acceptance criterion requires commercial rights, but is not itself evidence of those rights. These assets implement the user's supplied design references; independent commercial rights remain unverified. Confirm with the rights holder before commercial distribution requiring that clearance. No claim of real users, testimonials, demographic verification, or measured outcomes is made.

## Deliberate bounds

This is responsive design alignment, not a claim of pixel-identical reproduction of every prototype page. The newest Home v2 package contains only four composite mockups, two locale JSONs and the spec, not a standalone photo/three card asset set. Home therefore references the unchanged supplied Chinese desktop PNG and selects only its artwork region with CSS (x600–1586, y75–750 of1586×992). The navigation, main headline, paragraph, CTA buttons, benefits and step strip are live DOM and are not screenshot controls. The large original backdrop and all three original polaroids are retained; no older character or new imagery substitutes for them. Mobile uses the same artwork region first, followed by live Chinese copy and actions; this is a responsive translation, not a pixel-identical mobile composite. Other product routes inherit typography, tokens, card/button sizing, and readable labels; their functional content and analytics thresholds are preserved. Full 3-friend aggregation is not reduced merely to match aspirational marketing copy. Browser QA must cover changed type sizes across all routes, not just Home.

`design/home-v2-reference.png` is an unchanged copy of `Nolya_Page01_Home_New_Ambassador_v2_0/Nolya_Page01_Home_Desktop_zh-CN_v2_0.png`. The separate Page03 cafe/outdoor files remain available as supplied assets but are not used in the Home hero. The same unverified commercial-rights boundary applies.

## Verification

`frontend/tests/design-alignment.test.ts` checks original palette tokens, minimum fixed text size, locale-driven copy, supplied image availability, non-testimonial labeling, and shrinkable responsive layouts. Existing contrast and mobile-safe-area tests remain in place. These source-level checks complement, not replace, the release browser screenshots and interaction checks.

## Page09 follow-up alignment

Reviewed `Nolya_Page09_Guess_Me_China_Entry_v1_1/spec/Nolya_Page09_Guess_Me_UX_Implementation_Spec_v1_1.md` and the desktop reference PNG directly. The owner launch screen now uses its original two-column portrait composition, mobile portrait-first order, equal-weight noninteractive A/B previews, original headline, change-question action, solo return, and three flow-explanation tiles. The source selector and pagination remain available in an expandable control; only genuine backend-returned answer IDs are eligible. Saved choice values are removed from the launch view-model and never shown or highlighted in its DOM. Creating a round still sends the same selected source type and answer ID; scoring/reveal semantics are unchanged.

`design/guess-outdoor.png` is an unchanged copy of Page09's `source/assets/approved_young_ambassador_outdoor.png` (1122×1402). The spec expressly requires this photo instead of the Page03 cafe character. The same supplied-reference rights boundary above applies. DOM tests verify both options remain read-only, saved choice is absent, question cycling works, and the selected backend answer ID survives creation; source-level checks guard original asset and hidden-choice behavior.
