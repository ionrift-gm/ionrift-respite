import { isComfortEnabled } from "../../camp/gear/ComfortCalculator.js";

/**
 * Registers Respite-specific item enrichments with the shared library engine.
 * Called during init, after the library is available.
 */
export function registerItemEnrichments() {
    const comfortOn = isComfortEnabled();
    game.ionrift?.library?.enrichment?.registerBatch({

        "bedroll": {
            get html() {
                return comfortOn
                ? game.i18n.localize("ionrift-respite.enrichment.bedroll.htmlComfortOn")
                : game.i18n.localize("ionrift-respite.enrichment.bedroll.htmlComfortOff");
            },
            get tags() {
                return comfortOn ? [game.i18n.localize("ionrift-respite.enrichment.tags.plusOneHdRecovery")] : [game.i18n.localize("ionrift-respite.enrichment.tags.comfortOff")];
            }
        },

        "two-person tent": {
            get html() {
                return game.i18n.localize("ionrift-respite.enrichment.tent.html");
            },
            get tags() {
                return [game.i18n.localize("ionrift-respite.enrichment.tags.shelter"), game.i18n.localize("ionrift-respite.enrichment.tags.weatherProtection")];
            }
        },
        "tent, two-person": {
            get html() {
                return game.i18n.localize("ionrift-respite.enrichment.tent.html");
            },
            get tags() {
                return [game.i18n.localize("ionrift-respite.enrichment.tags.shelter"), game.i18n.localize("ionrift-respite.enrichment.tags.weatherProtection")];
            }
        },
        "pavilion": {
            get html() {
                return game.i18n.localize("ionrift-respite.enrichment.pavilion.html");
            },
            get tags() {
                return [game.i18n.localize("ionrift-respite.enrichment.tags.shelter"), game.i18n.localize("ionrift-respite.enrichment.tags.fullWeatherProtection")];
            }
        },
        "tent": {
            get html() {
                return game.i18n.localize("ionrift-respite.enrichment.tent.html");
            },
            get tags() {
                return [game.i18n.localize("ionrift-respite.enrichment.tags.shelter"), game.i18n.localize("ionrift-respite.enrichment.tags.weatherProtection")];
            }
        },

        "mess kit": {
            get html() {
                return comfortOn
                ? game.i18n.localize("ionrift-respite.enrichment.messKit.htmlComfortOn")
                : game.i18n.localize("ionrift-respite.enrichment.messKit.htmlComfortOff");
            },
            get tags() {
                return comfortOn ? [game.i18n.localize("ionrift-respite.enrichment.tags.exhaustionAdvantageWithFire")] : [game.i18n.localize("ionrift-respite.enrichment.tags.comfortOff")];
            }
        },

        "cook's utensils": {
            get html() {
                return comfortOn
                ? game.i18n.localize("ionrift-respite.enrichment.cooksUtensils.htmlComfortOn")
                : game.i18n.localize("ionrift-respite.enrichment.cooksUtensils.htmlComfortOff");
            },
            get tags() {
                return comfortOn ? [game.i18n.localize("ionrift-respite.enrichment.tags.exhaustionAdvantageWithFire"), game.i18n.localize("ionrift-respite.enrichment.tags.cookingProfession")] : [game.i18n.localize("ionrift-respite.enrichment.tags.cookingProfession"), game.i18n.localize("ionrift-respite.enrichment.tags.comfortOff")];
            }
        },

        "rations": {
            get html() {
                return game.i18n.localize("ionrift-respite.enrichment.rations.html");
            },
            get tags() {
                return [game.i18n.localize("ionrift-respite.enrichment.tags.mealPhaseOncePerDay")];
            }
        },
        "rations (1 day)": {
            get html() {
                return game.i18n.localize("ionrift-respite.enrichment.rations.html");
            },
            get tags() {
                return [game.i18n.localize("ionrift-respite.enrichment.tags.mealPhaseOncePerDay")];
            }
        },

        "waterskin": {
            get html() {
                return game.i18n.localize("ionrift-respite.enrichment.waterskin.html");
            },
            get tags() {
                return [game.i18n.localize("ionrift-respite.enrichment.tags.eightPintsPerDay"), game.i18n.localize("ionrift-respite.enrichment.tags.dehydrationTracking")];
            }
        },

        "herbalism kit": {
            get html() {
                return game.i18n.localize("ionrift-respite.enrichment.herbalismKit.html");
            },
            get tags() {
                return [game.i18n.localize("ionrift-respite.enrichment.tags.herbalismProfession")];
            }
        },

        "healer's kit": {
            get html() {
                return game.i18n.localize("ionrift-respite.enrichment.healersKit.html");
            },
            get tags() {
                return [game.i18n.localize("ionrift-respite.enrichment.tags.tendWoundsActivity")];
            }
        },

        "alchemist's supplies": {
            get html() {
                return game.i18n.localize("ionrift-respite.enrichment.alchemistsSupplies.html");
            },
            get tags() {
                return [game.i18n.localize("ionrift-respite.enrichment.tags.alchemyProfession")];
            }
        },

        "tinker's tools": {
            get html() {
                return game.i18n.localize("ionrift-respite.enrichment.tinkersTools.html");
            },
            get tags() {
                return [game.i18n.localize("ionrift-respite.enrichment.tags.tinkeringProfession")];
            }
        },

        "tinderbox": {
            get html() {
                return comfortOn
                ? game.i18n.localize("ionrift-respite.enrichment.tinderbox.htmlComfortOn")
                : game.i18n.localize("ionrift-respite.enrichment.tinderbox.htmlComfortOff");
            },
            get tags() {
                return comfortOn ? [game.i18n.localize("ionrift-respite.enrichment.tags.campfireRequired")] : [game.i18n.localize("ionrift-respite.enrichment.tags.comfortOff")];
            }
        },

        "fresh meat": {
            get html() {
                return game.i18n.localize("ionrift-respite.enrichment.freshMeat.html");
            },
            get tags() {
                return [game.i18n.localize("ionrift-respite.enrichment.tags.perishableOneDay"), game.i18n.localize("ionrift-respite.enrichment.tags.cookingIngredient")];
            }
        },
        "fresh fish": {
            get html() {
                return game.i18n.localize("ionrift-respite.enrichment.freshFish.html");
            },
            get tags() {
                return [game.i18n.localize("ionrift-respite.enrichment.tags.perishableOneDay"), game.i18n.localize("ionrift-respite.enrichment.tags.cookingIngredient")];
            }
        },
        "choice cut": {
            get html() {
                return game.i18n.localize("ionrift-respite.enrichment.choiceCut.html");
            },
            get tags() {
                return [game.i18n.localize("ionrift-respite.enrichment.tags.perishableOneDay"), game.i18n.localize("ionrift-respite.enrichment.tags.premiumIngredient")];
            }
        },
        "wild berries": {
            get html() {
                return game.i18n.localize("ionrift-respite.enrichment.wildBerries.html");
            },
            get tags() {
                return [game.i18n.localize("ionrift-respite.enrichment.tags.perishableThreeDay"), game.i18n.localize("ionrift-respite.enrichment.tags.edibleRaw"), game.i18n.localize("ionrift-respite.enrichment.tags.cookingIngredient")];
            }
        },
        "edible berries": {
            get html() {
                return game.i18n.localize("ionrift-respite.enrichment.edibleBerries.html");
            },
            get tags() {
                return [game.i18n.localize("ionrift-respite.enrichment.tags.perishableThreeDay"), game.i18n.localize("ionrift-respite.enrichment.tags.edibleRaw"), game.i18n.localize("ionrift-respite.enrichment.tags.cookingIngredient")];
            }
        },
        "edible mushrooms": {
            get html() {
                return game.i18n.localize("ionrift-respite.enrichment.edibleMushrooms.html");
            },
            get tags() {
                return [game.i18n.localize("ionrift-respite.enrichment.tags.perishableThreeDay"), game.i18n.localize("ionrift-respite.enrichment.tags.cookingIngredient")];
            }
        },
        "wild herbs": {
            get html() {
                return game.i18n.localize("ionrift-respite.enrichment.wildHerbs.html");
            },
            get tags() {
                return [game.i18n.localize("ionrift-respite.enrichment.tags.perishableThreeDay"), game.i18n.localize("ionrift-respite.enrichment.tags.cookingIngredient"), game.i18n.localize("ionrift-respite.enrichment.tags.herbalismIngredient")];
            }
        },
        "healing herbs": {
            get html() {
                return game.i18n.localize("ionrift-respite.enrichment.healingHerbs.html");
            },
            get tags() {
                return [game.i18n.localize("ionrift-respite.enrichment.tags.perishableThreeDay"), game.i18n.localize("ionrift-respite.enrichment.tags.herbalismIngredient")];
            }
        },
        "spiced jerky": {
            get html() {
                return game.i18n.localize("ionrift-respite.enrichment.spicedJerky.html");
            },
            get tags() {
                return [game.i18n.localize("ionrift-respite.enrichment.tags.shelfStable"), game.i18n.localize("ionrift-respite.enrichment.tags.mealPhaseOncePerDay")];
            }
        },
        "smoked fish": {
            get html() {
                return game.i18n.localize("ionrift-respite.enrichment.smokedFish.html");
            },
            get tags() {
                return [game.i18n.localize("ionrift-respite.enrichment.tags.shelfStable"), game.i18n.localize("ionrift-respite.enrichment.tags.mealPhaseOncePerDay")];
            }
        },
        "bird eggs": {
            get html() {
                return game.i18n.localize("ionrift-respite.enrichment.birdEggs.html");
            },
            get tags() {
                return [game.i18n.localize("ionrift-respite.enrichment.tags.perishableOneDay"), game.i18n.localize("ionrift-respite.enrichment.tags.cookingIngredient")];
            }
        }
    });
}

/**
 * All setting keys registered by this module.
 * Useful for structural tests that verify every expected key is present.
 */
export const SETTING_KEYS = [
    "partyRoster",
    "restInterfaceMode",
    "interceptRests",
    "armorDoffRule",
    "enableComfort",
    "enableCampfireMinigame",
    "enableWorkbenchIdentify",
    "spellRecoveryMaxLevel",
    "songOfRestTiming",
    "maxValueHitDice",
    "shortRestFireWarmth",
    "enableTraining",
    "trainingXpTier",
    "trainingXpTierMigrated",
    "enableProfessions",
    "enableBrewingAlcohol",
    "chefTreatCookingOnly",
    "chefTreatsProvideSustenance",
    "enableFletching",
    "fletchingYieldTier",
    "fletchingYieldTierMigrated",
    "enableEncounters",
    "enableCopySpell",
    "enablePrayMeditate",
    "enableForaging",
    "enableHunting",
    "campFuelFindChance",
    "homebrewProvisionOnly",
    "useTravel",
    "useTravelPhaseSemanticsMigrated",
    "trackFood",
    "partialSustenance",
    "spoilageNameSuffix",
    "lockPlayerQuantity",
    "lockAttuneOutsideRest",
    "lockSpellPrepOutsideRest",
    "safeRestSpot",
    "campfireTokenName",
    "torchTokenName",
    "torchAutoLink",
    "customFoodNames",
    "customWaterNames",
    "restRecoveryDetected",
    "lastRestDate",
    "lastTerrain",
    "lastWeather",
    "activeRest",
    "activeShortRest",
    "enabledPacks",
    "eventPoolSelection",
    "eventPoolInitialized",
    "eventPoolNudgeSuppressed",
    "eventPoolNudgeSnoozedUntil",
    "importedPacks",
    "artPackDisabled",
    "artPackCache",
    "artNudgeSnoozedUntil",
    "artNudgeSuppressed",
    "ambientAfkHud",
    "afkPanelLayout",
    "debug",
    "uiTheme"
];

/**
 * All menu keys registered by this module.
 */
export const MENU_KEYS = [
    "dietConfigMenu",
    "itemProvisionsConfig",
    "clearRestState"
];

/**
 * All enrichment item names registered.
 */
export const ENRICHMENT_KEYS = [
    "bedroll",
    "two-person tent",
    "tent, two-person",
    "pavilion",
    "tent",
    "mess kit",
    "cook's utensils",
    "rations",
    "rations (1 day)",
    "waterskin",
    "herbalism kit",
    "healer's kit",
    "alchemist's supplies",
    "tinker's tools",
    "tinderbox",
    "fresh meat",
    "fresh fish",
    "choice cut",
    "wild berries",
    "edible berries",
    "edible mushrooms",
    "wild herbs",
    "healing herbs",
    "spiced jerky",
    "smoked fish",
    "bird eggs"
];
