#include <Geode/Geode.hpp>
#include <Geode/modify/PlayLayer.hpp>
#include <Geode/utils/web.hpp>
#include <thread>
#include <algorithm>

using namespace geode::prelude;

// Should this level be tracked? Setting "tracked_level_ids" is a comma-separated
// list of level IDs; blank means track every level.
static bool levelTracked(int levelID) {
    auto s = Mod::get()->getSettingValue<std::string>("tracked_level_ids");
    s.erase(std::remove(s.begin(), s.end(), ' '), s.end());
    if (s.empty()) return true;
    return ("," + s + ",").find("," + std::to_string(levelID) + ",") != std::string::npos;
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
