# AnyRoyale card display names

This is a display-only change. `CARD_TEXTS` is the central bilingual source, keyed by stable Card ID. `cardName` and `cardDesc` serve menus, details, the pre-match deck, HUD tooltips and battle labels. `/api/cards` intentionally retains engine names; they remain asset/network keys, never replacement display names.

The current engine has 240 records; CardPool exposes 111 playable cards ({'TROOP': 77, 'SPELL': 22, 'BUILDING': 12}). Of these, 33 receive a new identity and 78 retain general/descriptive names. Goblin Hut also loses the internal `Rework` suffix in its English display name; this is a display cleanup, not a new identity.

Eight existing base HERO records have reserved bilingual text (seven renamed, Monk retained). They remain excluded from CardPool; no champion mechanics are enabled. They did not have Arabic display text before this change.

General names are retained even when used by Clash Royale: Knight, Archer, Giant, Golem, Goblins, Skeletons, Witch, Wizard, Phoenix, Bats, Cannon, Fireball, Arrows, Lightning, Tornado, Poison, Freeze, Rocket, and descriptive combinations such as Spear Goblins, Ice Wizard, Ice Golemite, Battle Ram and Skeleton Dragons. Rarity, abilities and all statistics remain engine-owned.

More distinctive identities are renamed, including the royal units, branded mechanical units, themed ambush/support units and the explicitly requested replacements. Historical/common terms such as Tesla, Prince and Princess are retained. Only the English formatting of the engine name is used in the old-name column; aliases such as Zap Machine (Sparky), Ghost (Royal Ghost), Giant Buffer (Rune Giant) and Merge Maiden (Spirit Empress) stay internal.

## Changes

| Card ID | Old English display | Old Arabic display | New English | New Arabic | Availability |
|---|---|---|---|---|---|
| `pekka` | Pekka | بيكا | Iron Sentinel | الحارس الحديدي | Playable |
| `skeletonarmy` | Skeleton Army | جيش الهياكل | Bone Legion | فيلق العظام | Playable |
| `babydragon` | Baby Dragon | التنين الصغير | Ember Drake | التنين الجمري | Playable |
| `minipekka` | Mini Pekka | بيكا الصغير | Iron Squire | الفارس الحديدي الصغير | Playable |
| `hogrider` | Hog Rider | راكب الخنزير | Boar Raider | مغير الخنزير البري | Playable |
| `royalgiant` | Royal Giant | العملاق الملكي | Siege Giant | عملاق الحصار | Playable |
| `darkprince` | Dark Prince | الأمير الأسود | Shadow Lancer | رمّاح الظلال | Playable |
| `lavahound` | Lava Hound | كلب الحمم | Magma Beast | وحش الحمم | Playable |
| `zapmachine` | Zap Machine | سباركي | Arc Cannon | مدفع الصواعق | Playable |
| `infernodragon` | Inferno Dragon | تنين الجحيم | Blazewing | جناح اللهب | Playable |
| `electrowizard` | Electro Wizard | الساحر الكهربائي | Storm Mage | ساحر العواصف | Playable |
| `royalrecruits` | Royal Recruits | المجندون الملكيون | Shield Company | كتيبة الدروع | Playable |
| `ghost` | Ghost | الشبح الملكي | Phantom Guard | الحارس الشبح | Playable |
| `ramrider` | Ram Rider | راكبة الكبش | Ram Charger | فارسة الكبش | Playable |
| `minisparkys` | Mini Sparkys | سباركي الصغيرة | Arc Sentries | حراس الصواعق | Playable |
| `rascals` | Rascals | الأشقياء | Alley Crew | رفاق الأزقة | Playable |
| `megaknight` | Mega Knight | الفارس الضخم | Titan Guardian | الحارس الجبار | Playable |
| `royalhogs` | Royal Hogs | الخنازير الملكية | Siege Boars | خنازير الحصار | Playable |
| `goblingiant` | Goblin Giant | العملاق العفريت | Brute Carrier | العملاق الحامل | Playable |
| `electrodragon` | Electro Dragon | التنين الكهربائي | Storm Drake | تنين العواصف | Playable |
| `firecracker` | Firecracker | المفرقعات | Blast Ranger | رامية المتفجرات | Playable |
| `battlehealer` | Battle Healer | المعالجة | Dawn Healer | معالجة الفجر | Playable |
| `witchmother` | Witch Mother | الأم الساحرة | Hex Matron | سيدة اللعنات | Playable |
| `electrogiant` | Electro Giant | العملاق الكهربائي | Thunder Colossus | الجبار الرعدي | Playable |
| `suspiciousbush` | Suspicious Bush | الشجيرة المريبة | Bramble Ambush | كمين الأشواك | Playable |
| `goblindemolisher` | Goblin Demolisher | هادم العفاريت | Fuse Raider | مغير المتفجرات | Playable |
| `giantbuffer` | Giant Buffer | عملاق الدعم | Warhorn Giant | عملاق بوق الحرب | Playable |
| `goblinmachine` | Goblin Machine | آلة العفاريت | Scrap Walker | آلة الخردة | Playable |
| `mergemaiden` | Merge Maiden | فتاة الدمج | Skybound Maiden | فارسة السماء | Playable |
| `goblinbarrel` | Goblin Barrel | برميل العفاريت | Raider Barrel | برميل المغيرين | Playable |
| `royaldelivery` | Royal Delivery | التوصيل الملكي | Guard Drop | إنزال الحارس | Playable |
| `goblinhut_rework` | Goblin Hut Rework | كوخ العفاريت | Goblin Hut | كوخ العفاريت | Playable |
| `infernotower` | Inferno Tower | برج الجحيم | Ember Spire | برج الجمر | Playable |
| `goblindrill` | Goblin Drill | مثقاب العفاريت | Burrow Drill | مثقاب الأنفاق | Playable |
| `mightyminer` | Mighty Miner | — (not previously localized) | Deepcore Champion | بطل الأعماق | Reserved champion |
| `skeletonking` | Skeleton King | — (not previously localized) | Bone Sovereign | سيد العظام | Reserved champion |
| `archerqueen` | Archer Queen | — (not previously localized) | Eagle Matriarch | سيدة النسور | Reserved champion |
| `goldenknight` | Golden Knight | — (not previously localized) | Sunsteel Knight | فارس الشمس | Reserved champion |
| `littleprince` | Little Prince | — (not previously localized) | Young Commander | القائد الشاب | Reserved champion |
| `goblinstein` | Goblinstein | — (not previously localized) | Volt Alchemist | كيميائي الصواعق | Reserved champion |
| `bossbandit` | Boss Bandit | — (not previously localized) | Outlaw Captain | قائدة الخارجين | Reserved champion |

## Retained playable names

| Card ID | English | Arabic |
|---|---|---|
| `knight` | Knight | الفارس |
| `archer` | Archer | الرماة |
| `goblins` | Goblins | العفاريت |
| `giant` | Giant | العملاق |
| `minions` | Minions | التوابع |
| `balloon` | Balloon | المنطاد |
| `witch` | Witch | الساحرة |
| `barbarians` | Barbarians | البرابرة |
| `golem` | Golem | الغولم |
| `skeletons` | Skeletons | الهياكل |
| `valkyrie` | Valkyrie | الفالكيري |
| `bomber` | Bomber | المفجّر |
| `musketeer` | Musketeer | الفرسانة |
| `prince` | Prince | الأمير |
| `wizard` | Wizard | الساحر |
| `speargoblins` | Spear Goblins | عفاريت الرماح |
| `giantskeleton` | Giant Skeleton | الهيكل العملاق |
| `minionhorde` | Minion Horde | حشد التوابع |
| `icewizard` | Ice Wizard | ساحر الجليد |
| `skeletonwarriors` | Skeleton Warriors | محاربو الهياكل |
| `princess` | Princess | الأميرة |
| `icespirits` | Ice Spirits | روح الجليد |
| `firespirits` | Fire Spirits | أرواح النار |
| `miner` | Miner | المنقّب |
| `bowler` | Bowler | رامي الصخور |
| `ragebarbarian` | Rage Barbarian | البربري الغاضب |
| `battleram` | Battle Ram | كبش المعركة |
| `icegolemite` | Ice Golemite | غولم الجليد |
| `megaminion` | Mega Minion | التابع الضخم |
| `blowdartgoblin` | Blowdart Goblin | عفريت النفخ |
| `goblingang` | Goblin Gang | عصابة العفاريت |
| `angrybarbarians` | Angry Barbarians | البرابرة الغاضبون |
| `hunter` | Hunter | الصياد |
| `axeman` | Axe Man | الجلّاد |
| `assassin` | Assassin | باندت |
| `darkwitch` | Dark Witch | الساحرة الليلية |
| `bats` | Bats | الخفافيش |
| `skeletonballoon` | Skeleton Balloon | منطاد الهياكل |
| `dartbarrell` | Dart Barrell | برميل السهام |
| `wallbreakers` | Wallbreakers | محطمو الجدران |
| `fisherman` | Fisherman | الصيّاد البحري |
| `elitearcher` | Elite Archer | الرماة النخبة |
| `elixirgolem` | Elixir Golem | غولم الإكسير |
| `skeletondragons` | Skeleton Dragons | تنانين الهياكل |
| `electrospirit` | Electro Spirit | الروح الكهربائية |
| `phoenix` | Phoenix | العنقاء |
| `berserker` | Berserker | المحاربة الهائجة |
| `fireball` | Fireball | كرة النار |
| `arrows` | Arrows | الأسهم |
| `rage` | Rage | الغضب |
| `rocket` | Rocket | الصاروخ |
| `freeze` | Freeze | التجميد |
| `mirror` | Mirror | المرآة |
| `lightning` | Lightning | البرق |
| `zap` | Zap | الصعقة |
| `poison` | Poison | السم |
| `graveyard` | Graveyard | المقبرة |
| `log` | Log | الجذع |
| `tornado` | Tornado | الإعصار |
| `clone` | Clone | الاستنساخ |
| `earthquake` | Earthquake | الزلزال |
| `barblog` | Barb Log | برميل البربري |
| `heal` | Heal | روح الشفاء |
| `snowball` | Snowball | كرة الثلج |
| `darkmagic` | Dark Magic | السحر الأسود |
| `goblincurse` | Goblin Curse | لعنة العفاريت |
| `vines` | Vines | الكروم |
| `cannon` | Cannon | المدفع |
| `mortar` | Mortar | الهاون |
| `bombtower` | Bomb Tower | برج القنابل |
| `barbarianhut` | Barbarian Hut | كوخ البرابرة |
| `tesla` | Tesla | تسلا |
| `elixircollector` | Elixir Collector | جامع الإكسير |
| `xbow` | Xbow | القوس الضخم |
| `tombstone` | Tombstone | شاهد القبر |
| `firespirithut` | Firespirit Hut | كوخ أرواح النار |
| `goblincage` | Goblin Cage | قفص العفريت |

## Full engine inventory review

All 240 records were inspected. Non-playable records below remain untouched: evolution/hero variants depend on stable engine/asset names, and zero-cost bombs, spawned units, containers and effects are not cards in the UI. Other non-playable base cards are not served by `/api/cards`. Reserved champion text is documented above. This change does not alter inclusion in CardPool.

| Card ID | Engine name (unchanged) | Type | Review |
|---|---|---|---|
| `knight` | Knight | TROOP | Playable: keep |
| `archer` | Archer | TROOP | Playable: keep |
| `goblins` | Goblins | TROOP | Playable: keep |
| `giant` | Giant | TROOP | Playable: keep |
| `pekka` | Pekka | TROOP | Playable: rename |
| `minions` | Minions | TROOP | Playable: keep |
| `balloon` | Balloon | TROOP | Playable: keep |
| `witch` | Witch | TROOP | Playable: keep |
| `barbarians` | Barbarians | TROOP | Playable: keep |
| `golem` | Golem | TROOP | Playable: keep |
| `skeletons` | Skeletons | TROOP | Playable: keep |
| `valkyrie` | Valkyrie | TROOP | Playable: keep |
| `skeletonarmy` | SkeletonArmy | TROOP | Playable: rename |
| `bomber` | Bomber | TROOP | Playable: keep |
| `musketeer` | Musketeer | TROOP | Playable: keep |
| `babydragon` | BabyDragon | TROOP | Playable: rename |
| `prince` | Prince | TROOP | Playable: keep |
| `wizard` | Wizard | TROOP | Playable: keep |
| `minipekka` | MiniPekka | TROOP | Playable: rename |
| `speargoblins` | SpearGoblins | TROOP | Playable: keep |
| `giantskeleton` | GiantSkeleton | TROOP | Playable: keep |
| `hogrider` | HogRider | TROOP | Playable: rename |
| `minionhorde` | MinionHorde | TROOP | Playable: keep |
| `icewizard` | IceWizard | TROOP | Playable: keep |
| `royalgiant` | RoyalGiant | TROOP | Playable: rename |
| `skeletonwarriors` | SkeletonWarriors | TROOP | Playable: keep |
| `princess` | Princess | TROOP | Playable: keep |
| `darkprince` | DarkPrince | TROOP | Playable: rename |
| `threemusketeers` | ThreeMusketeers | TROOP | Inactive base card; not exposed to UI |
| `lavahound` | LavaHound | TROOP | Playable: rename |
| `icespirits` | IceSpirits | TROOP | Playable: keep |
| `firespirits` | FireSpirits | TROOP | Playable: keep |
| `miner` | Miner | TROOP | Playable: keep |
| `zapmachine` | ZapMachine | TROOP | Playable: rename |
| `bowler` | Bowler | TROOP | Playable: keep |
| `ragebarbarian` | RageBarbarian | TROOP | Playable: keep |
| `battleram` | BattleRam | TROOP | Playable: keep |
| `infernodragon` | InfernoDragon | TROOP | Playable: rename |
| `icegolemite` | IceGolemite | TROOP | Playable: keep |
| `megaminion` | MegaMinion | TROOP | Playable: keep |
| `blowdartgoblin` | BlowdartGoblin | TROOP | Playable: keep |
| `goblingang` | GoblinGang | TROOP | Playable: keep |
| `electrowizard` | ElectroWizard | TROOP | Playable: rename |
| `angrybarbarians` | AngryBarbarians | TROOP | Playable: keep |
| `hunter` | Hunter | TROOP | Playable: keep |
| `axeman` | AxeMan | TROOP | Playable: keep |
| `assassin` | Assassin | TROOP | Playable: keep |
| `royalrecruits` | RoyalRecruits | TROOP | Playable: rename |
| `darkwitch` | DarkWitch | TROOP | Playable: keep |
| `bats` | Bats | TROOP | Playable: keep |
| `ghost` | Ghost | TROOP | Playable: rename |
| `ramrider` | RamRider | TROOP | Playable: rename |
| `minisparkys` | MiniSparkys | TROOP | Playable: rename |
| `rascals` | Rascals | TROOP | Playable: rename |
| `movingcannon` | MovingCannon | TROOP | Inactive base card; not exposed to UI |
| `megaknight` | MegaKnight | TROOP | Playable: rename |
| `skeletonballoon` | SkeletonBalloon | TROOP | Playable: keep |
| `dartbarrell` | DartBarrell | TROOP | Playable: keep |
| `wallbreakers` | Wallbreakers | TROOP | Playable: keep |
| `royalhogs` | RoyalHogs | TROOP | Playable: rename |
| `goblingiant` | GoblinGiant | TROOP | Playable: rename |
| `fisherman` | Fisherman | TROOP | Playable: keep |
| `elitearcher` | EliteArcher | TROOP | Playable: keep |
| `electrodragon` | ElectroDragon | TROOP | Playable: rename |
| `firecracker` | Firecracker | TROOP | Playable: rename |
| `elixirgolem` | ElixirGolem | TROOP | Playable: keep |
| `battlehealer` | BattleHealer | TROOP | Playable: rename |
| `skeletondragons` | SkeletonDragons | TROOP | Playable: keep |
| `witchmother` | WitchMother | TROOP | Playable: rename |
| `electrospirit` | ElectroSpirit | TROOP | Playable: keep |
| `electrogiant` | ElectroGiant | TROOP | Playable: rename |
| `phoenix` | Phoenix | TROOP | Playable: keep |
| `goblindemolisher` | GoblinDemolisher | TROOP | Playable: rename |
| `goblinmachine` | GoblinMachine | TROOP | Playable: rename |
| `suspiciousbush` | SuspiciousBush | TROOP | Playable: rename |
| `giantbuffer` | GiantBuffer | TROOP | Playable: rename |
| `berserker` | Berserker | TROOP | Playable: keep |
| `mightyminer` | MightyMiner | HERO | Reserved champion display text; not enabled |
| `skeletonking` | SkeletonKing | HERO | Reserved champion display text; not enabled |
| `archerqueen` | ArcherQueen | HERO | Reserved champion display text; not enabled |
| `goldenknight` | GoldenKnight | HERO | Reserved champion display text; not enabled |
| `monk` | Monk | HERO | Reserved champion display text; not enabled |
| `littleprince` | LittlePrince | HERO | Reserved champion display text; not enabled |
| `goblinstein` | Goblinstein | HERO | Reserved champion display text; not enabled |
| `bossbandit` | BossBandit | HERO | Reserved champion display text; not enabled |
| `fireball` | Fireball | SPELL | Playable: keep |
| `arrows` | Arrows | SPELL | Playable: keep |
| `rage` | Rage | SPELL | Playable: keep |
| `rocket` | Rocket | SPELL | Playable: keep |
| `goblinbarrel` | GoblinBarrel | SPELL | Playable: rename |
| `freeze` | Freeze | SPELL | Playable: keep |
| `mirror` | Mirror | SPELL | Playable: keep |
| `lightning` | Lightning | SPELL | Playable: keep |
| `zap` | Zap | SPELL | Playable: keep |
| `poison` | Poison | SPELL | Playable: keep |
| `graveyard` | Graveyard | SPELL | Playable: keep |
| `log` | Log | SPELL | Playable: keep |
| `tornado` | Tornado | SPELL | Playable: keep |
| `clone` | Clone | SPELL | Playable: keep |
| `earthquake` | Earthquake | SPELL | Playable: keep |
| `barblog` | BarbLog | SPELL | Playable: keep |
| `heal` | Heal | SPELL | Playable: keep |
| `snowball` | Snowball | SPELL | Playable: keep |
| `royaldelivery` | RoyalDelivery | SPELL | Playable: rename |
| `darkmagic` | DarkMagic | SPELL | Playable: keep |
| `goblincurse` | GoblinCurse | SPELL | Playable: keep |
| `mergemaiden` | MergeMaiden | TROOP | Playable: rename |
| `vines` | Vines | SPELL | Playable: keep |
| `cannon` | Cannon | BUILDING | Playable: keep |
| `goblinhut_rework` | GoblinHut_Rework | BUILDING | Playable: display-cleanup |
| `mortar` | Mortar | BUILDING | Playable: keep |
| `infernotower` | InfernoTower | BUILDING | Playable: rename |
| `bombtower` | BombTower | BUILDING | Playable: keep |
| `barbarianhut` | BarbarianHut | BUILDING | Playable: keep |
| `tesla` | Tesla | BUILDING | Playable: keep |
| `elixircollector` | ElixirCollector | BUILDING | Playable: keep |
| `xbow` | Xbow | BUILDING | Playable: keep |
| `tombstone` | Tombstone | BUILDING | Playable: keep |
| `firespirithut` | FirespiritHut | TROOP | Playable: keep |
| `barbarianlauncher` | BarbarianLauncher | BUILDING | Inactive base card; not exposed to UI |
| `goblincage` | GoblinCage | BUILDING | Playable: keep |
| `goblindrill` | GoblinDrill | BUILDING | Playable: rename |
| `goblinpartyhut` | GoblinPartyHut | BUILDING | Inactive base card; not exposed to UI |
| `darkelixir_bottle` | DarkElixir_Bottle | BUILDING | Inactive base card; not exposed to UI |
| `elixirbarrel` | ElixirBarrel | BUILDING | Inactive base card; not exposed to UI |
| `balloonbomb` | BalloonBomb | BUILDING | Internal sub-entity/effect; retain technical name |
| `bombtowerbomb` | BombTowerBomb | BUILDING | Internal sub-entity/effect; retain technical name |
| `giantskeletonbomb` | GiantSkeletonBomb | BUILDING | Internal sub-entity/effect; retain technical name |
| `ragebarbarianbottle` | RageBarbarianBottle | BUILDING | Internal sub-entity/effect; retain technical name |
| `skeletoncontainernew` | SkeletonContainerNew | BUILDING | Internal sub-entity/effect; retain technical name |
| `pekka_ev1` | Pekka_EV1 | TROOP | Inactive variant; retain technical name |
| `witch_ev1` | Witch_EV1 | TROOP | Inactive variant; retain technical name |
| `skeletonarmy_ev1` | SkeletonArmy_EV1 | TROOP | Inactive variant; retain technical name |
| `musketeer_ev1` | Musketeer_EV1 | TROOP | Inactive variant; retain technical name |
| `babydragon_ev1` | BabyDragon_EV1 | TROOP | Inactive variant; retain technical name |
| `ragebarbarian_ev1` | RageBarbarian_EV1 | TROOP | Inactive variant; retain technical name |
| `infernodragon_ev1` | InfernoDragon_EV1 | TROOP | Inactive variant; retain technical name |
| `blowdartgoblin_ev1` | BlowdartGoblin_EV1 | TROOP | Inactive variant; retain technical name |
| `hunter_ev1` | Hunter_EV1 | TROOP | Inactive variant; retain technical name |
| `axeman_ev1` | AxeMan_EV1 | TROOP | Inactive variant; retain technical name |
| `ghost_ev1` | Ghost_EV1 | TROOP | Inactive variant; retain technical name |
| `megaknight_ev1` | MegaKnight_EV1 | TROOP | Inactive variant; retain technical name |
| `skeletonballoon_ev1` | SkeletonBalloon_EV1 | TROOP | Inactive variant; retain technical name |
| `royalhogs_ev1` | RoyalHogs_EV1 | TROOP | Inactive variant; retain technical name |
| `goblingiant_ev1` | GoblinGiant_EV1 | TROOP | Inactive variant; retain technical name |
| `electrodragon_ev1` | ElectroDragon_EV1 | TROOP | Inactive variant; retain technical name |
| `goblinbarrel_ev1` | GoblinBarrel_EV1 | SPELL | Inactive variant; retain technical name |
| `zap_ev1` | Zap_EV1 | SPELL | Inactive variant; retain technical name |
| `snowball_ev1` | Snowball_EV1 | SPELL | Inactive variant; retain technical name |
| `firespirithut_ev1` | FirespiritHut_EV1 | TROOP | Inactive variant; retain technical name |
| `goblindrill_ev1` | GoblinDrill_EV1 | BUILDING | Inactive variant; retain technical name |
| `knight_hero` | Knight_hero | TROOP | Inactive variant; retain technical name |
| `archer_hero` | Archer_hero | TROOP | Inactive variant; retain technical name |
| `goblins_hero` | Goblins_hero | TROOP | Inactive variant; retain technical name |
| `giant_hero` | Giant_hero | TROOP | Inactive variant; retain technical name |
| `pekka_hero` | Pekka_hero | TROOP | Inactive variant; retain technical name |
| `minions_hero` | Minions_hero | TROOP | Inactive variant; retain technical name |
| `balloon_hero` | Balloon_hero | TROOP | Inactive variant; retain technical name |
| `witch_hero` | Witch_hero | TROOP | Inactive variant; retain technical name |
| `barbarians_hero` | Barbarians_hero | TROOP | Inactive variant; retain technical name |
| `golem_hero` | Golem_hero | TROOP | Inactive variant; retain technical name |
| `skeletons_hero` | Skeletons_hero | TROOP | Inactive variant; retain technical name |
| `valkyrie_hero` | Valkyrie_hero | TROOP | Inactive variant; retain technical name |
| `skeletonarmy_hero` | SkeletonArmy_hero | TROOP | Inactive variant; retain technical name |
| `bomber_hero` | Bomber_hero | TROOP | Inactive variant; retain technical name |
| `musketeer_hero` | Musketeer_hero | TROOP | Inactive variant; retain technical name |
| `babydragon_hero` | BabyDragon_hero | TROOP | Inactive variant; retain technical name |
| `prince_hero` | Prince_hero | TROOP | Inactive variant; retain technical name |
| `wizard_hero` | Wizard_hero | TROOP | Inactive variant; retain technical name |
| `minipekka_hero` | MiniPekka_hero | TROOP | Inactive variant; retain technical name |
| `speargoblins_hero` | SpearGoblins_hero | TROOP | Inactive variant; retain technical name |
| `giantskeleton_hero` | GiantSkeleton_hero | TROOP | Inactive variant; retain technical name |
| `hogrider_hero` | HogRider_hero | TROOP | Inactive variant; retain technical name |
| `minionhorde_hero` | MinionHorde_hero | TROOP | Inactive variant; retain technical name |
| `royalgiant_hero` | RoyalGiant_hero | TROOP | Inactive variant; retain technical name |
| `skeletonwarriors_hero` | SkeletonWarriors_hero | TROOP | Inactive variant; retain technical name |
| `princess_hero` | Princess_hero | TROOP | Inactive variant; retain technical name |
| `darkprince_hero` | DarkPrince_hero | TROOP | Inactive variant; retain technical name |
| `lavahound_hero` | LavaHound_hero | TROOP | Inactive variant; retain technical name |
| `icespirits_hero` | IceSpirits_hero | TROOP | Inactive variant; retain technical name |
| `firespirits_hero` | FireSpirits_hero | TROOP | Inactive variant; retain technical name |
| `miner_hero` | Miner_hero | TROOP | Inactive variant; retain technical name |
| `zapmachine_hero` | ZapMachine_hero | TROOP | Inactive variant; retain technical name |
| `bowler_hero` | Bowler_hero | TROOP | Inactive variant; retain technical name |
| `ragebarbarian_hero` | RageBarbarian_hero | TROOP | Inactive variant; retain technical name |
| `battleram_hero` | BattleRam_hero | TROOP | Inactive variant; retain technical name |
| `infernodragon_hero` | InfernoDragon_hero | TROOP | Inactive variant; retain technical name |
| `icegolemite_hero` | IceGolemite_hero | TROOP | Inactive variant; retain technical name |
| `megaminion_hero` | MegaMinion_hero | TROOP | Inactive variant; retain technical name |
| `blowdartgoblin_hero` | BlowdartGoblin_hero | TROOP | Inactive variant; retain technical name |
| `goblingang_hero` | GoblinGang_hero | TROOP | Inactive variant; retain technical name |
| `angrybarbarians_hero` | AngryBarbarians_hero | TROOP | Inactive variant; retain technical name |
| `hunter_hero` | Hunter_hero | TROOP | Inactive variant; retain technical name |
| `axeman_hero` | AxeMan_hero | TROOP | Inactive variant; retain technical name |
| `assassin_hero` | Assassin_hero | TROOP | Inactive variant; retain technical name |
| `royalrecruits_hero` | RoyalRecruits_hero | TROOP | Inactive variant; retain technical name |
| `darkwitch_hero` | DarkWitch_hero | TROOP | Inactive variant; retain technical name |
| `bats_hero` | Bats_hero | TROOP | Inactive variant; retain technical name |
| `ghost_hero` | Ghost_hero | TROOP | Inactive variant; retain technical name |
| `ramrider_hero` | RamRider_hero | TROOP | Inactive variant; retain technical name |
| `minisparkys_hero` | MiniSparkys_hero | TROOP | Inactive variant; retain technical name |
| `rascals_hero` | Rascals_hero | TROOP | Inactive variant; retain technical name |
| `movingcannon_hero` | MovingCannon_hero | TROOP | Inactive variant; retain technical name |
| `megaknight_hero` | MegaKnight_hero | TROOP | Inactive variant; retain technical name |
| `skeletonballoon_hero` | SkeletonBalloon_hero | TROOP | Inactive variant; retain technical name |
| `dartbarrell_hero` | DartBarrell_hero | TROOP | Inactive variant; retain technical name |
| `wallbreakers_hero` | Wallbreakers_hero | TROOP | Inactive variant; retain technical name |
| `royalhogs_hero` | RoyalHogs_hero | TROOP | Inactive variant; retain technical name |
| `goblingiant_hero` | GoblinGiant_hero | TROOP | Inactive variant; retain technical name |
| `fisherman_hero` | Fisherman_hero | TROOP | Inactive variant; retain technical name |
| `elitearcher_hero` | EliteArcher_hero | TROOP | Inactive variant; retain technical name |
| `electrodragon_hero` | ElectroDragon_hero | TROOP | Inactive variant; retain technical name |
| `firecracker_hero` | Firecracker_hero | TROOP | Inactive variant; retain technical name |
| `elixirgolem_hero` | ElixirGolem_hero | TROOP | Inactive variant; retain technical name |
| `battlehealer_hero` | BattleHealer_hero | TROOP | Inactive variant; retain technical name |
| `skeletondragons_hero` | SkeletonDragons_hero | TROOP | Inactive variant; retain technical name |
| `witchmother_hero` | WitchMother_hero | TROOP | Inactive variant; retain technical name |
| `electrospirit_hero` | ElectroSpirit_hero | TROOP | Inactive variant; retain technical name |
| `electrogiant_hero` | ElectroGiant_hero | TROOP | Inactive variant; retain technical name |
| `phoenix_hero` | Phoenix_hero | TROOP | Inactive variant; retain technical name |
| `goblindemolisher_hero` | GoblinDemolisher_hero | TROOP | Inactive variant; retain technical name |
| `goblinmachine_hero` | GoblinMachine_hero | TROOP | Inactive variant; retain technical name |
| `suspiciousbush_hero` | SuspiciousBush_hero | TROOP | Inactive variant; retain technical name |
| `giantbuffer_hero` | GiantBuffer_hero | TROOP | Inactive variant; retain technical name |
| `berserker_hero` | Berserker_hero | TROOP | Inactive variant; retain technical name |
| `heal_hero` | Heal_hero | TROOP | Inactive variant; retain technical name |
| `cannon_hero` | Cannon_hero | BUILDING | Inactive variant; retain technical name |
| `goblinhut_hero` | GoblinHut_hero | BUILDING | Inactive variant; retain technical name |
| `mortar_hero` | Mortar_hero | BUILDING | Inactive variant; retain technical name |
| `infernotower_hero` | InfernoTower_hero | BUILDING | Inactive variant; retain technical name |
| `bombtower_hero` | BombTower_hero | BUILDING | Inactive variant; retain technical name |
| `barbarianhut_hero` | BarbarianHut_hero | BUILDING | Inactive variant; retain technical name |
| `tesla_hero` | Tesla_hero | BUILDING | Inactive variant; retain technical name |
| `elixir_collector_hero` | Elixir Collector_hero | BUILDING | Inactive variant; retain technical name |
| `xbow_hero` | Xbow_hero | BUILDING | Inactive variant; retain technical name |
| `tombstone_hero` | Tombstone_hero | BUILDING | Inactive variant; retain technical name |
| `firespirithut_hero` | FirespiritHut_hero | TROOP | Inactive variant; retain technical name |
| `goblincage_hero` | GoblinCage_hero | BUILDING | Inactive variant; retain technical name |
| `goblindrill_hero` | GoblinDrill_hero | BUILDING | Inactive variant; retain technical name |
| `rage_hero` | Rage_hero | BUILDING | Inactive variant; retain technical name |

## Validation

- `node tools/compatibility/card-names.mjs`: derives IDs from CardPool; checks bilingual completeness, uniqueness, the audit, active language switching, UI leakage guards and unmodified network names. Run with Node >=22.18 after `npm ci` in apps/web.
- `npm run build` in apps/web: TypeScript and production build.
- `tests/browser/specs/card-names.spec.ts`: checks every playable card/detail, rendered portraits, costs/stats, language round-trip, pre-match titles and battle tooltips through the real Java server.
- Existing Gradle and browser tests remain unchanged.

Rollback: revert the single naming commit with `git revert <commit>`; do not reset history or force-push.

## Comparison against upstream card identities

Reference: pinned `server/engine/UPSTREAM_CARD_TRACKER.md` (CR Name / Internal ID); decisions are based on the role and identity, not just the technical string. Generic words are kept even when the reference uses them.

| Card ID | Reference identity | Current English display | Decision |
|---|---|---|---|
| `knight` | Knight | Knight | keep |
| `archer` | Archers | Archer | keep |
| `goblins` | Goblins | Goblins | keep |
| `giant` | Giant | Giant | keep |
| `pekka` | P.E.K.K.A | Iron Sentinel | rename |
| `minions` | Minions | Minions | keep |
| `balloon` | Balloon | Balloon | keep |
| `witch` | Witch | Witch | keep |
| `barbarians` | Barbarians | Barbarians | keep |
| `golem` | Golem | Golem | keep |
| `skeletons` | Skeletons | Skeletons | keep |
| `valkyrie` | Valkyrie | Valkyrie | keep |
| `skeletonarmy` | Skeleton Army | Bone Legion | rename |
| `bomber` | Bomber | Bomber | keep |
| `musketeer` | Musketeer | Musketeer | keep |
| `babydragon` | Baby Dragon | Ember Drake | rename |
| `prince` | Prince | Prince | keep |
| `wizard` | Wizard | Wizard | keep |
| `minipekka` | Mini P.E.K.K.A | Iron Squire | rename |
| `speargoblins` | Spear Goblins | Spear Goblins | keep |
| `giantskeleton` | Giant Skeleton | Giant Skeleton | keep |
| `hogrider` | Hog Rider | Boar Raider | rename |
| `minionhorde` | Minion Horde | Minion Horde | keep |
| `icewizard` | Ice Wizard | Ice Wizard | keep |
| `royalgiant` | Royal Giant | Siege Giant | rename |
| `skeletonwarriors` | Guards | Skeleton Warriors | keep |
| `princess` | Princess | Princess | keep |
| `darkprince` | Dark Prince | Shadow Lancer | rename |
| `lavahound` | Lava Hound | Magma Beast | rename |
| `icespirits` | Ice Spirit | Ice Spirits | keep |
| `firespirits` | Fire Spirit | Fire Spirits | keep |
| `miner` | Miner | Miner | keep |
| `zapmachine` | Sparky | Arc Cannon | rename |
| `bowler` | Bowler | Bowler | keep |
| `ragebarbarian` | Lumberjack | Rage Barbarian | keep |
| `battleram` | Battle Ram | Battle Ram | keep |
| `infernodragon` | Inferno Dragon | Blazewing | rename |
| `icegolemite` | Ice Golem | Ice Golemite | keep |
| `megaminion` | Mega Minion | Mega Minion | keep |
| `blowdartgoblin` | Dart Goblin | Blowdart Goblin | keep |
| `goblingang` | Goblin Gang | Goblin Gang | keep |
| `electrowizard` | Electro Wizard | Storm Mage | rename |
| `angrybarbarians` | Elite Barbarians | Angry Barbarians | keep |
| `hunter` | Hunter | Hunter | keep |
| `axeman` | Executioner | Axe Man | keep |
| `assassin` | Bandit | Assassin | keep |
| `royalrecruits` | Royal Recruits | Shield Company | rename |
| `darkwitch` | Night Witch | Dark Witch | keep |
| `bats` | Bats | Bats | keep |
| `ghost` | Royal Ghost | Phantom Guard | rename |
| `ramrider` | Ram Rider | Ram Charger | rename |
| `minisparkys` | Zappies | Arc Sentries | rename |
| `rascals` | Rascals | Alley Crew | rename |
| `megaknight` | Mega Knight | Titan Guardian | rename |
| `skeletonballoon` | Skeleton Barrel | Skeleton Balloon | keep |
| `dartbarrell` | Flying Machine | Dart Barrell | keep |
| `wallbreakers` | Wall Breakers | Wallbreakers | keep |
| `royalhogs` | Royal Hogs | Siege Boars | rename |
| `goblingiant` | Goblin Giant | Brute Carrier | rename |
| `fisherman` | Fisherman | Fisherman | keep |
| `elitearcher` | Magic Archer | Elite Archer | keep |
| `electrodragon` | Electro Dragon | Storm Drake | rename |
| `firecracker` | Firecracker | Blast Ranger | rename |
| `elixirgolem` | Elixir Golem | Elixir Golem | keep |
| `battlehealer` | Battle Healer | Dawn Healer | rename |
| `skeletondragons` | Skeleton Dragons | Skeleton Dragons | keep |
| `witchmother` | Mother Witch | Hex Matron | rename |
| `electrospirit` | Electro Spirit | Electro Spirit | keep |
| `electrogiant` | Electro Giant | Thunder Colossus | rename |
| `phoenix` | Phoenix | Phoenix | keep |
| `suspiciousbush` | Suspicious Bush | Bramble Ambush | rename |
| `berserker` | Berserker | Berserker | keep |
| `goblindemolisher` | Goblin Demolisher | Fuse Raider | rename |
| `giantbuffer` | Rune Giant | Warhorn Giant | rename |
| `goblinmachine` | Goblin Machine | Scrap Walker | rename |
| `mergemaiden` | Spirit Empress | Skybound Maiden | rename |
| `fireball` | Fireball | Fireball | keep |
| `arrows` | Arrows | Arrows | keep |
| `rage` | Rage | Rage | keep |
| `rocket` | Rocket | Rocket | keep |
| `goblinbarrel` | Goblin Barrel | Raider Barrel | rename |
| `freeze` | Freeze | Freeze | keep |
| `mirror` | Mirror | Mirror | keep |
| `lightning` | Lightning | Lightning | keep |
| `zap` | Zap | Zap | keep |
| `poison` | Poison | Poison | keep |
| `graveyard` | Graveyard | Graveyard | keep |
| `log` | The Log | Log | keep |
| `tornado` | Tornado | Tornado | keep |
| `clone` | Clone | Clone | keep |
| `earthquake` | Earthquake | Earthquake | keep |
| `barblog` | Barbarian Barrel | Barb Log | keep |
| `heal` | Heal Spirit | Heal | keep |
| `snowball` | Snowball | Snowball | keep |
| `royaldelivery` | Royal Delivery | Guard Drop | rename |
| `darkmagic` | Void | Dark Magic | keep |
| `goblincurse` | Goblin Curse | Goblin Curse | keep |
| `vines` | Vines | Vines | keep |
| `cannon` | Cannon | Cannon | keep |
| `goblinhut_rework` | Goblin Hut | Goblin Hut | display-cleanup |
| `mortar` | Mortar | Mortar | keep |
| `infernotower` | Inferno Tower | Ember Spire | rename |
| `bombtower` | Bomb Tower | Bomb Tower | keep |
| `barbarianhut` | Barbarian Hut | Barbarian Hut | keep |
| `tesla` | Tesla | Tesla | keep |
| `elixircollector` | Elixir Collector | Elixir Collector | keep |
| `xbow` | X-Bow | Xbow | keep |
| `tombstone` | Tombstone | Tombstone | keep |
| `firespirithut` | Furnace | Firespirit Hut | keep |
| `goblincage` | Goblin Cage | Goblin Cage | keep |
| `goblindrill` | Goblin Drill | Burrow Drill | rename |
| `mightyminer` | Mighty Miner | Deepcore Champion | rename |
| `skeletonking` | Skeleton King | Bone Sovereign | rename |
| `archerqueen` | Archer Queen | Eagle Matriarch | rename |
| `goldenknight` | Golden Knight | Sunsteel Knight | rename |
| `littleprince` | Little Prince | Young Commander | rename |
| `goblinstein` | Goblinstein | Volt Alchemist | rename |
| `bossbandit` | Boss Bandit | Outlaw Captain | rename |
| `monk` | Monk | Monk | keep |

## Validation performed for this change

- Baseline/default branch: `claude/anyroyale-browser-game-6g7zwk`, commit `7399b480d9cbe6937f32d136982bbbe27b49c921`.
- `npm run build`: passed (TypeScript + Vite production build).
- `npm run test:card-names`: passed for all 111 playable names and 8 reserved champions; actual engine inventory contains 240 records.
- Gradle `test :server:installDist`: passed. Core: 892 passed; data: 41 passed; server: 150 passed, 2 existing disabled debug/experiment tests skipped. Total: 1,083 passed, 2 skipped, zero failures/errors.
- Full Playwright `chromium-mobile` suite: 31 passed, including every card/detail in English/Arabic/English, portraits, costs/stats, intro/HUD names, bots, a complete expert-bot match, input/rotation, identity, online play, reconnects and private rooms.
- Playwright `chromium-desktop` card naming suite: 3 passed.
- Card support check: 111 playable cards, 121 engine entities, zero missing visuals; regenerated CARD_SUPPORT.md is identical to the baseline.
- Asset inventory Python test: 1 passed.
- `git diff --check`: passed.
- Source diff against baseline: server, shared protocols, audio, rendering, public assets and CARD_SUPPORT.md are unchanged. There are no changes to balance data, identifiers, battle/AI rules, maps, models, animations, camera, lighting or Render/deployment settings.

Environment-only setup: downloaded Gradle/JDK and Chrome Headless Shell outside the repository; used the environment's Java trust store/proxy and a temporary Gradle init script to pre-load the test agent (the sandbox blocks Mockito self-attachment). No project dependency versions or build configuration were changed. Initial environment setup/regular Chrome launch attempts failed; the completed runs above succeeded. WebKit/Safari and Firefox were not run locally.
