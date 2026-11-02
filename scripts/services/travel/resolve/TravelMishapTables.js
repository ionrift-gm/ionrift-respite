export const TravelMishapMethods = {
    _rollForageMishap(terrainTag) {
        const tables = {
            forest: [
                {
                    type: "condition",
                    description: game.i18n.localize("ionrift-respite.travelResolver.mishap.forage.forest.toxic"),
                    effects: [{ type: "condition", condition: "poisoned", duration: "next_rest" }]
                },
                {
                    type: "economy",
                    description: game.i18n.localize("ionrift-respite.travelResolver.mishap.forage.forest.waterskin"),
                    effects: [{ type: "consume_resource", resource: "water", amount: 1 }]
                },
                {
                    type: "rest_penalty",
                    description: game.i18n.localize("ionrift-respite.travelResolver.mishap.forage.forest.turnedAround"),
                    effects: [{ type: "travel_penalty", penalty: "activity_disadvantage" }]
                },
                {
                    type: "escalation",
                    description: game.i18n.localize("ionrift-respite.travelResolver.mishap.forage.forest.nest"),
                    effects: [{ type: "encounter_mod", encounterDCDelta: -2 }]
                }
            ],
            swamp: [
                {
                    type: "condition",
                    description: game.i18n.localize("ionrift-respite.travelResolver.mishap.forage.swamp.diseased"),
                    effects: [{ type: "condition", condition: "diseased", duration: "permanent" }]
                },
                {
                    type: "economy",
                    description: game.i18n.localize("ionrift-respite.travelResolver.mishap.forage.swamp.rations"),
                    effects: [{ type: "consume_resource", resource: "rations", amount: 1 }]
                },
                {
                    type: "rest_penalty",
                    description: game.i18n.localize("ionrift-respite.travelResolver.mishap.forage.swamp.bog"),
                    effects: [{ type: "recovery_penalty", hpMultiplier: 0.5 }]
                },
                {
                    type: "slot_loss",
                    description: game.i18n.localize("ionrift-respite.travelResolver.mishap.forage.swamp.lost"),
                    effects: [{ type: "travel_penalty", penalty: "lose_activity" }]
                }
            ],
            desert: [
                {
                    type: "condition",
                    description: game.i18n.localize("ionrift-respite.travelResolver.mishap.forage.desert.heatExhaustion"),
                    effects: [{ type: "exhaustion_delta", levels: 1 }]
                },
                {
                    type: "economy",
                    description: game.i18n.localize("ionrift-respite.travelResolver.mishap.forage.desert.waterskin"),
                    effects: [{ type: "consume_resource", resource: "water", amount: 1 }]
                },
                {
                    type: "escalation",
                    description: game.i18n.localize("ionrift-respite.travelResolver.mishap.forage.desert.viper"),
                    effects: [{ type: "encounter_mod", encounterDCDelta: -2 }]
                },
                {
                    type: "rest_penalty",
                    description: game.i18n.localize("ionrift-respite.travelResolver.mishap.forage.desert.sunstroke"),
                    effects: [{ type: "recovery_penalty", hpMultiplier: 0.5 }]
                }
            ],
            mountain: [
                {
                    type: "rest_penalty",
                    description: game.i18n.localize("ionrift-respite.travelResolver.mishap.forage.mountain.ankle"),
                    effects: [{ type: "travel_penalty", penalty: "activity_disadvantage" }]
                },
                {
                    type: "economy",
                    description: game.i18n.localize("ionrift-respite.travelResolver.mishap.forage.mountain.pack"),
                    effects: [{ type: "supply_loss", amount: 1 }]
                },
                {
                    type: "escalation",
                    description: game.i18n.localize("ionrift-respite.travelResolver.mishap.forage.mountain.rocks"),
                    effects: [{ type: "encounter_mod", encounterDCDelta: -2 }]
                },
                {
                    type: "rest_penalty",
                    description: game.i18n.localize("ionrift-respite.travelResolver.mishap.forage.mountain.altitude"),
                    effects: [{ type: "recovery_penalty", hpMultiplier: 0.5 }]
                }
            ],
            arctic: [
                {
                    type: "condition",
                    description: game.i18n.localize("ionrift-respite.travelResolver.mishap.forage.arctic.frostbite"),
                    effects: [{ type: "exhaustion_delta", levels: 1 }]
                },
                {
                    type: "economy",
                    description: game.i18n.localize("ionrift-respite.travelResolver.mishap.forage.arctic.wind"),
                    effects: [{ type: "consume_resource", resource: "rations", amount: 1 }]
                },
                {
                    type: "rest_penalty",
                    description: game.i18n.localize("ionrift-respite.travelResolver.mishap.forage.arctic.hypothermia"),
                    effects: [{ type: "recovery_penalty", hpMultiplier: 0.5 }]
                },
                {
                    type: "slot_loss",
                    description: game.i18n.localize("ionrift-respite.travelResolver.mishap.forage.arctic.whiteout"),
                    effects: [{ type: "travel_penalty", penalty: "lose_activity" }]
                }
            ]
        };

        const pool = tables[terrainTag] ?? tables.forest;
        return pool[Math.floor(Math.random() * pool.length)];
    },

    _rollHuntMishap(terrainTag) {
        const tables = {
            forest: [
                {
                    type: "escalation",
                    description: game.i18n.localize("ionrift-respite.travelResolver.mishap.hunt.forest.escaped"),
                    effects: [{ type: "encounter_mod", encounterDCDelta: -2 }]
                },
                {
                    type: "economy",
                    description: game.i18n.localize("ionrift-respite.travelResolver.mishap.hunt.forest.bowstring"),
                    effects: [{
                        type: "condition",
                        condition: "disadvantage_attack",
                        duration: "1_attack",
                        label: game.i18n.localize("ionrift-respite.travelResolver.disadvantageNextAttack")
                    }]
                },
                {
                    type: "slot_loss",
                    description: game.i18n.localize("ionrift-respite.travelResolver.mishap.hunt.forest.chase"),
                    effects: [{ type: "travel_penalty", penalty: "lose_activity" }]
                },
                {
                    type: "condition",
                    description: game.i18n.localize("ionrift-respite.travelResolver.mishap.hunt.forest.gored"),
                    effects: [{ type: "condition", condition: "poisoned", duration: "next_rest" }]
                }
            ],
            swamp: [
                {
                    type: "escalation",
                    description: game.i18n.localize("ionrift-respite.travelResolver.mishap.hunt.swamp.waterMonster"),
                    effects: [{ type: "encounter_mod", encounterDCDelta: -2 }]
                },
                {
                    type: "condition",
                    description: game.i18n.localize("ionrift-respite.travelResolver.mishap.hunt.swamp.bitten"),
                    effects: [{ type: "condition", condition: "poisoned", duration: "next_rest" }]
                },
                {
                    type: "rest_penalty",
                    description: game.i18n.localize("ionrift-respite.travelResolver.mishap.hunt.swamp.muck"),
                    effects: [{ type: "recovery_penalty", hpMultiplier: 0.5 }]
                },
                {
                    type: "slot_loss",
                    description: game.i18n.localize("ionrift-respite.travelResolver.mishap.hunt.swamp.fog"),
                    effects: [{ type: "travel_penalty", penalty: "lose_activity" }]
                }
            ],
            desert: [
                {
                    type: "escalation",
                    description: game.i18n.localize("ionrift-respite.travelResolver.mishap.hunt.desert.deathCry"),
                    effects: [{ type: "encounter_mod", encounterDCDelta: -2 }]
                },
                {
                    type: "condition",
                    description: game.i18n.localize("ionrift-respite.travelResolver.mishap.hunt.desert.heatstroke"),
                    effects: [{ type: "exhaustion_delta", levels: 1 }]
                },
                {
                    type: "economy",
                    description: game.i18n.localize("ionrift-respite.travelResolver.mishap.hunt.desert.spear"),
                    effects: [{
                        type: "condition",
                        condition: "disadvantage_attack",
                        duration: "1_attack",
                        label: game.i18n.localize("ionrift-respite.travelResolver.disadvantageNextAttack")
                    }]
                },
                {
                    type: "rest_penalty",
                    description: game.i18n.localize("ionrift-respite.travelResolver.mishap.hunt.desert.dehydrated"),
                    effects: [{ type: "recovery_penalty", hpMultiplier: 0.5 }]
                }
            ],
            mountain: [
                {
                    type: "escalation",
                    description: game.i18n.localize("ionrift-respite.travelResolver.mishap.hunt.mountain.rockslide"),
                    effects: [{ type: "encounter_mod", encounterDCDelta: -2 }]
                },
                {
                    type: "rest_penalty",
                    description: game.i18n.localize("ionrift-respite.travelResolver.mishap.hunt.mountain.scree"),
                    effects: [{ type: "travel_penalty", penalty: "activity_disadvantage" }]
                },
                {
                    type: "economy",
                    description: game.i18n.localize("ionrift-respite.travelResolver.mishap.hunt.mountain.equipment"),
                    effects: [{
                        type: "condition",
                        condition: "disadvantage_attack",
                        duration: "1_attack",
                        label: game.i18n.localize("ionrift-respite.travelResolver.disadvantageNextAttack")
                    }]
                },
                {
                    type: "slot_loss",
                    description: game.i18n.localize("ionrift-respite.travelResolver.mishap.hunt.mountain.deadEnd"),
                    effects: [{ type: "travel_penalty", penalty: "lose_activity" }]
                }
            ],
            arctic: [
                {
                    type: "escalation",
                    description: game.i18n.localize("ionrift-respite.travelResolver.mishap.hunt.arctic.blood"),
                    effects: [{ type: "encounter_mod", encounterDCDelta: -2 }]
                },
                {
                    type: "condition",
                    description: game.i18n.localize("ionrift-respite.travelResolver.mishap.hunt.arctic.frostbite"),
                    effects: [{ type: "exhaustion_delta", levels: 1 }]
                },
                {
                    type: "rest_penalty",
                    description: game.i18n.localize("ionrift-respite.travelResolver.mishap.hunt.arctic.thinIce"),
                    effects: [{ type: "recovery_penalty", hpMultiplier: 0.5 }]
                },
                {
                    type: "slot_loss",
                    description: game.i18n.localize("ionrift-respite.travelResolver.mishap.hunt.arctic.blizzard"),
                    effects: [{ type: "travel_penalty", penalty: "lose_activity" }]
                }
            ]
        };

        const pool = tables[terrainTag] ?? tables.forest;
        return pool[Math.floor(Math.random() * pool.length)];
    }

};
