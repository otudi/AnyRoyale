"""Writes recipes.json: one entry per unit that gets its own forged model.

Run: python3 recipes.py   (then: blender --background --python forge.py -- recipes.json out)

Every recipe picks a base rig, body parts from any KayKit adventurer (they share one skeleton),
named texture regions to recolour (see REGIONS in forge.py) and procedural accessories. Designs
are original stylised interpretations of each card's role; they are not copies of any game's art.
"""
import json
import os


def body(model, prefix, legs=None, arms=None):
    legs = legs or (model, prefix)
    arms = arms or (model, prefix)
    return [
        [model, f'{prefix}_Body'],
        [arms[0], f'{arms[1]}_ArmLeft'],
        [arms[0], f'{arms[1]}_ArmRight'],
        [legs[0], f'{legs[1]}_LegLeft'],
        [legs[0], f'{legs[1]}_LegRight'],
    ]


KNIGHT = body('knight', 'Knight')
BARB = body('barbarian', 'Barbarian')
MAGE = body('mage', 'Mage')
ROGUE = body('rogue', 'Rogue')

H_KNIGHT = ['knight', 'Knight_Head']
H_BARB = ['barbarian', 'Barbarian_Head']
H_MAGE = ['mage', 'Mage_Head']
H_ROGUE = ['rogue', 'Rogue_Head']
H_HOOD = ['rogue_hooded', 'Rogue_Head_Hooded']


def item(model, name, team=False):
    return [model, name, {'team': True}] if team else [model, name]


SWORD = item('knight', '1H_Sword')
SWORD_OFF = item('knight', '1H_Sword_Offhand')
GREATSWORD = item('knight', '2H_Sword')
ROUND_SHIELD = item('knight', 'Round_Shield')
RECT_SHIELD = item('knight', 'Rectangle_Shield')
SPIKE_SHIELD = item('knight', 'Spike_Shield')
BADGE_SHIELD = item('knight', 'Badge_Shield')
HELMET = item('knight', 'Knight_Helmet')
AXE = item('barbarian', '1H_Axe')
AXE_OFF = item('barbarian', '1H_Axe_Offhand')
GREATAXE = item('barbarian', '2H_Axe')
BARB_HAT = item('barbarian', 'Barbarian_Hat')
STAFF = item('mage', '2H_Staff')
WAND = item('mage', '1H_Wand')
BOOK = item('mage', 'Spellbook_open')
MAGE_HAT = item('mage', 'Mage_Hat')
CROSSBOW = item('rogue', '2H_Crossbow')
HAND_CROSSBOW = item('rogue', '1H_Crossbow')
KNIFE = item('rogue', 'Knife')
KNIFE_OFF = item('rogue', 'Knife_Offhand')
THROWABLE = item('rogue', 'Throwable')

GOBLIN_SKIN = '#7cc04a'


def acc(kind, **kw):
    return {'kind': kind, **kw}


def goblin(parts_extra, colors=None, accessories=None):
    colors = colors or {}
    rogue = {'skin': GOBLIN_SKIN, 'hair': '#3a2a1a', **colors.pop('rogue', {})}
    return {
        'base': 'rogue',
        'parts': [H_ROGUE, *ROGUE, *parts_extra],
        'colors': {'rogue': rogue, **colors},
        'accessories': [acc('ears'), *(accessories or [])],
    }


U = {}

# --- Knights and armoured fighters -------------------------------------------------------------
U['Knight'] = {
    'base': 'knight', 'parts': [H_KNIGHT, *KNIGHT, SWORD, ROUND_SHIELD],
    'colors': {'knight': {'hair': '#6a3a1e'}},
    'accessories': [acc('mustache', color='#6a3a1e'), acc('cape')],
}
U['Prince'] = {
    'base': 'knight', 'parts': [*KNIGHT],
    'colors': {'knight': {'metal': '#e2c36a', 'hair': '#f0c850', 'leather': '#7a3a8a'}},
    'accessories': [acc('helmet', color='#e8cc70', plume='team', visor=True, visor_color='#3a2a10'), acc('spear', color='#f2e6b8'), acc('cape')],
}
U['DarkPrince'] = {
    'base': 'knight', 'parts': [*KNIGHT, SPIKE_SHIELD],
    'colors': {'knight': {'metal': '#3a3a4a', 'plate': '#2a2a36', 'leather': '#4a2a2a', 'under': '#2a2a30'}},
    'accessories': [acc('helmet', color='#2e2e3a', visor=True, visor_color='#ff5030', horns=True, horn_color='#1e1e26'), acc('hammer', color='#2e2e3a'), acc('shoulders', color='#2e2e3a', spikes='#8a8a96')],
}
U['Recruit'] = {
    'base': 'knight', 'parts': [H_KNIGHT, *KNIGHT, HELMET, RECT_SHIELD],
    'colors': {'knight': {'metal': '#a8b4c0', 'cape': '#2f6fd8', 'hair': '#3a2a1a'}},
    'accessories': [acc('spear'), acc('scarf')],
}
U['MiniPekka'] = {
    'base': 'knight', 'parts': [*KNIGHT, GREATSWORD],
    'colors': {'knight': {'metal': '#3d5aa8', 'plate': '#2a3a78', 'under': '#1e2a50', 'leather': '#1e2a50', 'gloves': '#1e2a50'}},
    'accessories': [acc('helmet', color='#3d5aa8', visor=True, visor_color='#7ae0ff', horns=True, horn_color='#c8d4e8'), acc('shoulders', color='#2a3a78')],
}
U['Pekka'] = {
    'base': 'knight', 'parts': [*KNIGHT, GREATSWORD],
    'colors': {'knight': {'metal': '#4a2e7a', 'plate': '#2e1e50', 'under': '#1e1430', 'leather': '#1e1430', 'gloves': '#1e1430'}},
    'accessories': [acc('helmet', color='#4a2e7a', visor=True, visor_color='#c86aff', horns=True, horn_color='#2e1e50'), acc('shoulders', color='#4a2e7a', size=1.3, spikes='#c86aff'), acc('chestplate', color='#3a2460', emblem='#c86aff')],
}
U['MegaKnight'] = {
    'base': 'knight', 'parts': [*KNIGHT, SPIKE_SHIELD],
    'colors': {'knight': {'metal': '#3a4048', 'plate': '#2a2e34', 'under': '#1e2024', 'leather': '#2a2e34'}},
    'accessories': [acc('helmet', color='#3a4048', visor=True, visor_color='#ffb030'), acc('shoulders', color='#3a4048', size=1.45, spikes='#c8ccd4'), acc('hammer', color='#4a5058'), acc('chestplate', color='#2e3238', emblem='#ffb030')],
}
U['BattleHealer'] = {
    'base': 'knight', 'parts': [H_ROGUE, *KNIGHT, BADGE_SHIELD],
    'colors': {'knight': {'metal': '#f2e6c0', 'cape': '#ffffff', 'leather': '#c8a050'}, 'rogue': {'hair': '#ffd86a'}},
    'accessories': [acc('halo'), acc('wings', color='#fff8e0'), acc('hammer', color='#f2d070'), acc('pigtails', color='#ffd86a')],
}

# --- Barbarians and giants --------------------------------------------------------------------------
U['Barbarian'] = {
    'base': 'barbarian', 'parts': [H_BARB, *BARB, BARB_HAT, SWORD],
    'colors': {'barbarian': {'beard': '#f0c040', 'fur': '#8a5a2c'}},
    'accessories': [acc('mustache', color='#f0c040'), acc('cape')],
}
U['AngryBarbarian'] = {
    'base': 'barbarian', 'parts': [H_BARB, *BARB, SWORD, SWORD_OFF],
    'colors': {'barbarian': {'beard': '#e84a2a', 'shirt': '#3a3a48', 'fur': '#2a2a30'}},
    'accessories': [acc('mohawk', color='#e84a2a'), acc('scarf'), acc('shoulders', color='#5a5a66')],
}
U['RageBarbarian'] = {
    'base': 'barbarian', 'parts': [H_BARB, *BARB, GREATAXE],
    'colors': {'barbarian': {'beard': '#c8301e', 'shirt': '#f0b48a', 'fur': '#5a2a1e', 'skin': '#f0a080'}},
    'accessories': [acc('helmet', color='#8a3020', horns=True, horn_color='#f2e6c8'), acc('fur_collar', color='#5a2a1e')],
}
U['Berserker'] = {
    'base': 'barbarian', 'parts': [H_ROGUE, *BARB, AXE, AXE_OFF],
    'colors': {'rogue': {'hair': '#c82a3a'}, 'barbarian': {'shirt': '#3a2a48', 'fur': '#c82a3a'}},
    'accessories': [acc('mohawk', color='#c82a3a'), acc('scarf')],
}
U['AxeMan'] = {
    'base': 'barbarian', 'parts': [H_HOOD, *BARB, GREATAXE],
    'colors': {'barbarian': {'shirt': '#2a2a32', 'fur': '#1e1e24', 'pants': '#2a2a32', 'leather': '#3a2a20'}, 'rogue': {'tunic2': '#1e1e24'}},
    'accessories': [acc('mask', color='#1e1e24', eyes='#ff4030'), acc('cape')],
}
U['Fisherman'] = {
    'base': 'barbarian', 'parts': [H_BARB, *BARB],
    'colors': {'barbarian': {'beard': '#f2f2f2', 'shirt': '#f0c030', 'fur': '#e0a020', 'pants': '#2a5a8a'}},
    'accessories': [acc('cap', color='#f0c030', brim='#e0a020'), acc('rod'), acc('backpack', color='#2a5a8a')],
}
U['RascalBoy'] = {
    'base': 'barbarian', 'parts': [H_KNIGHT, *BARB],
    'colors': {'knight': {'hair': '#c8501e'}, 'barbarian': {'shirt': '#3a6ad8', 'fur': '#8a5a2c', 'pants': '#3a4a6a'}},
    'accessories': [acc('cap', team=True), acc('club')],
}
U['Miner'] = {
    'base': 'barbarian', 'parts': [H_BARB, *BARB],
    'colors': {'barbarian': {'beard': '#8a5a2c', 'shirt': '#7a5a3a', 'fur': '#5a3a20', 'pants': '#4a4a52'}},
    'accessories': [acc('helmet', color='#f0c030'), acc('headlamp'), acc('hammer', color='#8a96a8'), acc('backpack', color='#6a4a2a')],
}
U['GoblinBrawler'] = goblin([], {'rogue': {'tunic': '#6a4a2a', 'tunic2': '#8a5a2c'}}, [acc('mohawk', color='#3a2a1a'), acc('fur_collar', color='#8a5a2c')])
U['Giant'] = {
    'base': 'barbarian', 'parts': [H_BARB, *BARB],
    'colors': {'barbarian': {'beard': '#e8641e', 'shirt': '#8a5a2c', 'fur': '#6a4422', 'pants': '#6a4a8a', 'skin': '#f4b88a'}},
    'accessories': [acc('cape')],
}
U['RoyalGiant'] = {
    'base': 'barbarian', 'parts': [H_BARB, *BARB],
    'colors': {'barbarian': {'beard': '#f0d070', 'shirt': '#2a4a9a', 'fur': '#e8c050', 'pants': '#1e2e60'}},
    'accessories': [acc('crown', size=0.8), acc('cannon', color='#3a3a44'), acc('cape')],
}
U['ElectroGiant'] = {
    'base': 'barbarian', 'parts': [H_BARB, *BARB],
    'colors': {'barbarian': {'beard': '#4ad8ff', 'shirt': '#1e3a8a', 'fur': '#2a6ad8', 'pants': '#1e2e60'}},
    'accessories': [acc('goggles', lens='#9af0ff'), acc('shoulders', color='#2a6ad8', spikes='#ffe04a'), acc('backpack', color='#3a4a6a', roll='#ffe04a')],
}
U['GoblinGiant'] = goblin([], {'rogue': {'tunic': '#6a4a2a', 'tunic2': '#4a3a20', 'pants': '#4a3a20'}}, [acc('backpack', color='#8a5a2c', roll='#c8a060'), acc('fur_collar', color='#8a5a2c')])
U['GiantBuffer'] = {
    'base': 'barbarian', 'parts': [H_BARB, *BARB],
    'colors': {'barbarian': {'skin': '#c8a8ff', 'beard': '#f2f2f2', 'shirt': '#4a2a7a', 'fur': '#2a1a4a', 'pants': '#2a1a4a'}},
    'accessories': [acc('chestplate', color='#5a3a8a', emblem='#7af0ff'), acc('shoulders', color='#5a3a8a', spikes='#7af0ff'), acc('hammer', color='#7af0ff')],
}
U['Bowler'] = {
    'base': 'barbarian', 'parts': [H_BARB, *BARB],
    'colors': {'barbarian': {'skin': '#7aa0e0', 'beard': '#e8e8f0', 'shirt': '#3a4a7a', 'fur': '#2a3a5a', 'pants': '#2a3a5a'}},
    'accessories': [acc('bomb', color='#8a8a92'), acc('fur_collar', color='#c8c8d0')],
}
U['HogRider'] = {
    'base': 'barbarian', 'parts': [H_BARB, *BARB],
    'colors': {'barbarian': {'beard': '#4a2a1a', 'shirt': '#c8a070', 'fur': '#6a4422'}},
    'accessories': [acc('mohawk', color='#4a2a1a'), acc('hammer', color='#a8b0bc')],
}
U['Hunter'] = {
    'base': 'barbarian', 'parts': [H_BARB, *BARB],
    'colors': {'barbarian': {'beard': '#d8d8d8', 'shirt': '#5a6a3a', 'fur': '#3a4a2a', 'pants': '#4a3a2a'}},
    'accessories': [acc('cap', color='#5a6a3a', brim='#3a4a2a'), acc('cannon', color='#5a3a20'), acc('backpack', color='#6a4a2a')],
}

# --- Archers and rogues -----------------------------------------------------------------------------
U['Archer'] = {
    'base': 'rogue', 'parts': [H_ROGUE, *ROGUE, CROSSBOW],
    'colors': {'rogue': {'hair': '#ff5aa8', 'tunic': '#2f8a4a', 'tunic2': '#4ab05a'}},
    'accessories': [acc('quiver'), acc('cape')],
}
U['Musketeer'] = {
    'base': 'rogue', 'parts': [H_ROGUE, *ROGUE, HELMET],
    'colors': {'rogue': {'hair': '#2a1a14', 'tunic': '#5a2a7a', 'tunic2': '#7a3a9a'}, 'knight': {'metal': '#c8ccd4'}},
    'accessories': [acc('cannon', color='#4a3a2a'), acc('scarf')],
}
U['Princess'] = {
    'base': 'rogue', 'parts': [H_ROGUE, *ROGUE, CROSSBOW],
    'colors': {'rogue': {'hair': '#ffd84a', 'tunic': '#e86aa8', 'tunic2': '#ff9ac8', 'pants': '#e86aa8'}},
    'accessories': [acc('tiara'), acc('skirt', color='#e86aa8'), acc('cape')],
}
U['EliteArcher'] = {
    'base': 'rogue', 'parts': [H_HOOD, *ROGUE, CROSSBOW],
    'colors': {'rogue': {'tunic': '#1e4a8a', 'tunic2': '#2a6ad8', 'pants': '#1e2e50'}},
    'accessories': [acc('mask', color='#1e2e50'), acc('quiver', color='#3a2a20')],
}
U['Firecracker'] = {
    'base': 'rogue', 'parts': [H_ROGUE, *ROGUE],
    'colors': {'rogue': {'hair': '#ff6a1a', 'tunic': '#c82a2a', 'tunic2': '#ffb030'}},
    'accessories': [acc('goggles', lens='#ffcf4a'), acc('cannon', color='#c82a2a'), acc('backpack', color='#3a3a44', roll='#ffb030')],
}
U['RascalGirl'] = {
    'base': 'rogue', 'parts': [H_ROGUE, *ROGUE, THROWABLE],
    'colors': {'rogue': {'hair': '#6a3a1e', 'tunic': '#d8402a', 'tunic2': '#ff7a4a'}},
    'accessories': [acc('pigtails', color='#6a3a1e'), acc('scarf')],
}
U['Assassin'] = {
    'base': 'rogue', 'parts': [H_HOOD, *ROGUE, KNIFE, KNIFE_OFF],
    'colors': {'rogue': {'tunic': '#24242e', 'tunic2': '#36364a', 'pants': '#1a1a22', 'leather': '#3a2a2a'}},
    'accessories': [acc('mask', color='#1a1a22', eyes='#ff3048'), acc('cape')],
}
U['RamRider'] = {
    'base': 'rogue', 'parts': [H_ROGUE, *ROGUE, THROWABLE],
    'colors': {'rogue': {'hair': '#f2f2f2', 'tunic': '#8a5a2c', 'tunic2': '#c8a070'}},
    'accessories': [acc('helmet', color='#8a5a2c', horns=True, horn_color='#f2e6c8'), acc('fur_collar', color='#efe4d0')],
}

# --- Goblins ------------------------------------------------------------------------------------------
U['Goblin'] = goblin([KNIFE], {'rogue': {'tunic': '#6a4a2a', 'tunic2': '#8a5a2c'}}, [acc('cap', team=True)])
U['BushGoblin'] = goblin([KNIFE], {'rogue': {'tunic': '#3a7a2a', 'tunic2': '#5aa83a'}}, [acc('fur_collar', color='#4a9a3a')])
U['SpearGoblin'] = goblin([], {'rogue': {'tunic': '#8a5a2c', 'tunic2': '#c8a070'}}, [acc('spear'), acc('scarf')])
U['BlowdartGoblin'] = goblin([], {'rogue': {'tunic': '#2a6a4a', 'tunic2': '#4a9a6a'}}, [acc('mask', color='#c8a060'), acc('staff_orb', color='#4ad8a0'), acc('mohawk', color='#e84a2a')])
U['GoblinDemolisher'] = goblin([], {'rogue': {'tunic': '#5a3a20', 'tunic2': '#8a5a2c'}}, [acc('goggles', lens='#ffcf4a'), acc('belt_bombs'), acc('bomb')])
U['GoblinDemolisher_kamikaze_form'] = goblin([], {'rogue': {'tunic': '#5a3a20', 'tunic2': '#8a5a2c'}}, [acc('goggles', lens='#ff6a3a'), acc('belt_bombs'), acc('bomb', color='#c82a2a')])

# --- Spellcasters -------------------------------------------------------------------------------------
U['Wizard'] = {
    'base': 'mage', 'parts': [H_MAGE, *MAGE, item('mage', 'Mage_Hat', team=True), STAFF],
    'colors': {'mage': {'robe': '#b8322a', 'robe_dark': '#7a1e1a', 'sash': '#ffb020', 'hair': '#e8e0d0', 'crystal': '#ff7a1e'}},
    'accessories': [acc('beard', color='#ece6da')],
}
U['IceWizard'] = {
    'base': 'mage', 'parts': [H_HOOD, *MAGE, STAFF],
    'colors': {'mage': {'robe': '#4a8ad8', 'robe_dark': '#2a5aa8', 'sash': '#c8ecff', 'crystal': '#9af0ff', 'skin': '#d8e8f8'}, 'rogue': {'tunic2': '#2a6ad8', 'skin': '#d8e8f8'}},
    'accessories': [acc('beard', color='#f2f8ff', long=1.3), acc('fur_collar', color='#e8f4ff')],
}
U['ElectroWizard'] = {
    'base': 'mage', 'parts': [H_MAGE, *MAGE, WAND],
    'colors': {'mage': {'robe': '#1e3a8a', 'robe_dark': '#12245a', 'sash': '#ffe04a', 'hair': '#9af0ff', 'gem': '#ffe04a'}},
    'accessories': [acc('mohawk', color='#4ad8ff'), acc('goggles', lens='#ffe04a'), acc('cape'), acc('staff_orb', hand='l', color='#9af0ff')],
}
U['Witch'] = {
    'base': 'mage', 'parts': [H_ROGUE, *MAGE, STAFF],
    'colors': {'rogue': {'hair': '#2a1a3a', 'skin': '#cfe8b8'}, 'mage': {'robe': '#5a2a7a', 'robe_dark': '#36184a', 'skin': '#cfe8b8', 'sash': '#9adf4a', 'crystal': '#9adf4a'}},
    'accessories': [acc('witch_hat', color='#3a1e55', band='#9adf4a'), acc('cape')],
}
U['DarkWitch'] = {
    'base': 'mage', 'parts': [H_ROGUE, *MAGE, STAFF],
    'colors': {'rogue': {'hair': '#e8e8f0', 'skin': '#b8b0c8'}, 'mage': {'robe': '#24202e', 'robe_dark': '#16141c', 'skin': '#b8b0c8', 'sash': '#c8304a', 'crystal': '#ff3a5a'}},
    'accessories': [acc('witch_hat', color='#16141c', band='#c8304a'), acc('wings', color='#2a2436'), acc('cape')],
}
U['WitchMother'] = {
    'base': 'mage', 'parts': [H_ROGUE, *MAGE, BOOK],
    'colors': {'rogue': {'hair': '#b0b0b8', 'skin': '#e8c8b0'}, 'mage': {'robe': '#7a3a8a', 'robe_dark': '#4a2054', 'sash': '#ff9ac8', 'book': '#5a2a7a'}},
    'accessories': [acc('witch_hat', color='#4a2054', band='#ff9ac8'), acc('pigtails', color='#b0b0b8'), acc('lantern', color='#9adf4a')],
}

# Units that look exactly like another one reuse its file (see FORGED_ALIASES in visualCatalog.ts).
ALIASES = {'DeliveryRecruit': 'Recruit', 'Goblin_Stab': 'Goblin', 'SpearGoblinGiant': 'SpearGoblin'}

json.dump({'units': U, 'aliases': ALIASES}, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'recipes.json'), 'w'), indent=1)
print(len(U), 'recipes')
