# Page02–08 design implementation

Reviewed v1.1 implementation specs and actual Chinese desktop mockups in the supplied NolyaV1.1 packages. No flattened UI screenshots are used. Images are copied unchanged from each page's standalone assets. Existing Page04 invitation scenes remain in use. Shared global CSS and components are untouched by this scoped change.

| Design | Runtime | Implementation |
|---|---|---|
|02 Self questionnaire|/self|Live question/progress/options left, original natural portrait right; shallow mobile photo before interactive content.|
|03 Self result|/self/result|Actual summary and observations left, cafe portrait and outdoor inset right; responsive mobile compact outdoor portrait alongside the heading. Feedback and sharing preserved.|
|04 Invitation|/invite|Existing desktop/mobile original friend scene preserved.|
|05 Friend landing|/friend/:token before start|Original page-specific scene right, benefits and live consent/start left; photo first mobile; accessible inline how-it-works disclosure.|
|06 Friend questions|/friend/:token after start|Single live question left, original full portrait/explanation right. Large marketing portrait hidden on narrow screens as explicitly required in the source spec; a small illustrative brand thumbnail remains beside the question header.|
|07 First mirror|/mirror with1–2 responses|Original cafe portrait left, actual per-dimension Self/Friends comparisons right. White DOM note covers outdated lettering in the supplied source photograph. Mobile uses a shallow top crop, excluding the old text, plus a fresh DOM caption.|
|08 Full mirror|/mirror server state full|Original main portrait plus two supporting photos left, actual comparisons/counts/insights right. Mobile switches to the supplied mobile_portrait.jpg and hides desktop insets. No invented three-person quotes or profiles.|

Asset provenance: self-question-portrait.jpg from Page02 assets/shan_young_portrait_natural_crop.jpg; friend-landing-desktop/mobile.png from Page05 source/assets/page05_approved_shan_scene_desktop/mobile.png; friend-question-portrait.png from Page06 source/assets/shan_young_original_ref_02.png; first-mirror-cafe.jpg from Page07 source/assets/page07_approved_shan_cafe_photo_crop.jpg; full-mirror-main/glance/rest.jpg from Page08 source/assets/main_portrait.jpg,side_glance.jpg,side_rest.jpg. Existing ambassador-cafe/outdoor.jpg map to Page03 original source assets. These are supplied design references, not independently commercially cleared or real user avatars.

Data boundaries: API-authenticated question IDs, dynamic choices, explicit consent, server submission, no-registration guest participation, result feedback and sharing remain intact. One/two-response state is not promoted to full consensus. The API's comparison and insight fields are displayed as returned; no fixture labels, raw question rewrite, new scoring or fabricated individual friend cards are introduced. Page08's reference individual friend cards cannot be populated by the current aggregate-only Mirror API, so they are intentionally not fabricated. Source Page05 secondary explainer is an inline keyboard-accessible details panel rather than a modal; this avoids a redundant overlay while retaining the same explanatory content.

Tests: design-self-friends.test.ts checks supplied photo presence, preserved dynamic bindings and consent, and source-defined mobile behavior. Browser acceptance must cover 320/390px and desktop live states, including all8 Self answers, all3 Friends answers, first mirror and server-confirmed full mirror.

Mobile-specific unchanged assets: self-result-mobile.jpg from Page03 source/assets/shan_young_mobile_crop_v1_0.jpg; full-mirror-mobile.jpg from Page08 source/assets/mobile_portrait.jpg. All six Chinese mobile mockups reviewed in addition to their desktop counterparts.
