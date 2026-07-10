#include <Geode/Geode.hpp>
#include <Geode/modify/PlayLayer.hpp>
#include <Geode/modify/LevelInfoLayer.hpp>
#include <Geode/utils/web.hpp>
#include <thread>
#include <algorithm>

using namespace geode::prelude;

// ── tracked-levels list ("tracked_level_ids" setting, comma-separated) ────────
static std::vector<std::string> trackedList() {
    auto s = Mod::get()->getSettingValue<std::string>("tracked_level_ids");
    std::vector<std::string> out;
    std::string cur;
    for (char c : s) {
        if (c == ',') { if (!cur.empty()) out.push_back(cur); cur.clear(); }
        else if (c != ' ') cur += c;
    }
    if (!cur.empty()) out.push_back(cur);
    return out;
}

// Exact membership (used by the button).
static bool isTracked(int levelID) {
    auto id = std::to_string(levelID);
    for (auto& x : trackedList()) if (x == id) return true;
    return false;
}

// Add/remove a level id from the setting and save it.
static void toggleTracked(int levelID) {
    auto id = std::to_string(levelID);
    std::string out;
    bool removed = false;
    for (auto& x : trackedList()) {
        if (x == id) { removed = true; continue; }
        if (!out.empty()) out += ",";
        out += x;
    }
    if (!removed) { if (!out.empty()) out += ","; out += id; }
    Mod::get()->setSettingValue<std::string>("tracked_level_ids", out);
}

// Should this level be tracked for run posting? Blank list = track every level.
static bool levelTracked(int levelID) {
    if (trackedList().empty()) return true;
    return isTracked(levelID);
}

// Fire-and-forget POST of one run to the local bio-updater. The updater does all
// the filtering (100% or span > threshold) and bio formatting — the mod just
// reports every attempt's start% -> end%. postSync blocks, so run it on a
// detached thread to keep the game's main thread free.
static void postRun(int start, int end, std::string const& level) {
    if (!Mod::get()->getSettingValue<bool>("enabled_tracking")) return;

    matjson::Value body;
    body["start"] = start;
    body["end"] = end;
    body["level"] = level;
    // Push the configured server id + optional token so the updater has them.
    body["server_id"] = Mod::get()->getSettingValue<std::string>("server_id");
    body["token"] = Mod::get()->getSettingValue<std::string>("discord_token");

    auto url = Mod::get()->getSettingValue<std::string>("updater_url");

    std::thread([body = std::move(body), url = std::move(url)]() {
        web::WebRequest req;
        req.header("Content-Type", "application/json");
        req.bodyJSON(body);
        req.postSync(url); // blocking on this background thread only
    }).detach();
}

class $modify(BioPlayLayer, PlayLayer) {
    struct Fields {
        int startPct = 0;      // % where this attempt began (0, a start pos, or a checkpoint)
        bool posted = false;   // one report per attempt
        bool captured = false; // start% captured yet this attempt?
    };

    // New attempt — re-capture start% on the first frame (below), so a start pos /
    // checkpoint / first run all read their real starting %, not 0.
    void resetLevel() {
        PlayLayer::resetLevel();
        m_fields->posted = false;
        m_fields->captured = false;
    }

    // First frame after a (re)start: read the actual starting % once it's applied.
    void postUpdate(float dt) {
        PlayLayer::postUpdate(dt);
        if (!m_fields->captured) {
            m_fields->startPct = this->getCurrentPercentInt();
            m_fields->captured = true;
        }
    }

    // Death — report start -> where we died.
    void destroyPlayer(PlayerObject* player, GameObject* obj) {
        PlayLayer::destroyPlayer(player, obj);
        if (m_fields->posted) return;
        if (!levelTracked(m_level ? m_level->m_levelID : 0)) return;
        m_fields->posted = true;
        int end = this->getCurrentPercentInt();
        std::string name = m_level ? std::string(m_level->m_levelName) : std::string();
        postRun(m_fields->startPct, end, name);
    }

    // Completion — report start -> 100.
    void levelComplete() {
        PlayLayer::levelComplete();
        if (m_fields->posted) return;
        if (!levelTracked(m_level ? m_level->m_levelID : 0)) return;
        m_fields->posted = true;
        std::string name = m_level ? std::string(m_level->m_levelName) : std::string();
        postRun(m_fields->startPct, 100, name);
    }
};

// Track/Untrack button on the level page — click to add this level to the tracked
// list, click again to remove it.
class $modify(TrackButtonLevelInfo, LevelInfoLayer) {
    struct Fields {
        ButtonSprite* sprite = nullptr;
    };

    bool init(GJGameLevel* level, bool challenge) {
        if (!LevelInfoLayer::init(level, challenge)) return false;

        int id = level ? level->m_levelID : 0;
        auto spr = ButtonSprite::create(isTracked(id) ? "Tracked" : "Track", "bigFont.fnt", "GJ_button_05.png", 0.5f);
        spr->setScale(0.6f);
        m_fields->sprite = spr;

        auto btn = CCMenuItemSpriteExtra::create(spr, this, menu_selector(TrackButtonLevelInfo::onToggleTrack));
        auto menu = CCMenu::create();
        menu->addChild(btn);
        menu->setContentSize({ 0, 0 });
        btn->setPosition({ 0, 0 });

        auto win = CCDirector::get()->getWinSize();
        menu->setPosition({ win.width - 42.f, win.height - 90.f });
        menu->setID("bio-track-menu"_spr);
        this->addChild(menu, 100);
        return true;
    }

    void onToggleTrack(CCObject*) {
        int id = m_level ? m_level->m_levelID : 0;
        toggleTracked(id);
        if (m_fields->sprite) m_fields->sprite->setString(isTracked(id) ? "Tracked" : "Track");
    }
};
