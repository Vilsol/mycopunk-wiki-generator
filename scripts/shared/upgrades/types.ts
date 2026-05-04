import type {
	MycopunkDumperDataJson,
	Upgrade,
	HexMap,
	UpgradeDProperty,
	StatData,
	DUpgradeable,
	DUnlockCost,
	DIcon
} from '../data/schema';

export type {
	MycopunkDumperDataJson,
	Upgrade,
	HexMap,
	UpgradeDProperty,
	StatData,
	DUpgradeable,
	DUnlockCost,
	DIcon
};

// Top-level dump. The schema root requires every catalog (gears, characters, …);
// data.json populates them all, so we accept the full shape and expose `upgrades`
// directly.
export type DataDump = MycopunkDumperDataJson;

// Legacy aliases — narrowed to the fields data.json always populates so existing
// consumers don't need to litter the codebase with non-null assertions.
export type GenericGunUpgrade = Omit<
	Upgrade,
	'Pattern' | 'Properties' | 'UnlockCost' | 'Description' | 'Color' | 'Name' | 'Icon'
> & {
	readonly Pattern: Pattern;
	readonly Properties: Property[];
	readonly UnlockCost: DUnlockCost[];
	readonly Description: string;
	readonly Color: string;
	readonly Name: string;
	readonly Icon: DIcon;
};

// Runtime-narrowed `HexMap`. The schema marks every field optional; data.json
// always populates them, so legacy consumers use these interfaces directly.
export interface Pattern {
	readonly width: number;
	readonly height: number;
	readonly nodes: NodeList[];
}

export interface NodeList {
	readonly nodes: PatternNode[];
}

export interface PatternNode {
	readonly enabled: boolean;
	readonly connections: Direction;
}

export type Property = Omit<UpgradeDProperty, 'Raw' | 'StatsByUpgradable'> & {
	readonly Raw: RawProperty;
	readonly StatsByUpgradable?: Record<string, Stat[]>;
};

export type Stat = StatData & {
	readonly name: string;
	readonly value: string;
	readonly minValue: string;
	readonly maxValue: string;
	readonly labelType: LabelType;
	readonly overrideType: OverrideType;
};

export type ApplicableTo = DUpgradeable;
export type ResourceCost = DUnlockCost;
export type Icon = DIcon;

export interface WwiseEventReference {
	readonly instanceID: number;
}

export interface GameObject {
	readonly instanceID: number;
}

export interface AnimationClip {
	readonly instanceID: number;
}

export interface BurstEffect {
	readonly instanceID: number;
}

export enum Direction {
	None = 0,

	// [InspectorName("↑")]
	North = 1,

	// [InspectorName("↗")]
	NorthEast = 2,

	// [InspectorName("↘")]
	SouthEast = 4,

	// [InspectorName("↓")]
	South = 8,

	// [InspectorName("↙")]
	SouthWest = 16,

	// [InspectorName("↖")]
	NorthWest = 32
}

export enum LabelType {
	Before,
	BeforeWithColon,
	After
}

export enum ActionFireMode {
	CannotPerformDuring,
	CanPerformDuring,
	StopActionAndPerform
}

export enum OverrideType {
	None,
	Add,
	Multiply,
	Override
}

// Hand-typed narrowing for `UpgradeDProperty.Raw`, which the schema leaves as
// `unknown` (Unity-serialized — fields vary per UpgradeProperty subclass).
export interface RawProperty {
	readonly speed?: Range<number>;
	readonly duration?: Range<number> | OverrideData<Range<number>>;
	readonly maxHits?: OverrideData<Range<number>>;
	readonly hitSpeedMultiplier?: OverrideData<Range<number>>;
	readonly bulletGravity?: OverrideData<Range<number>>;
	readonly bulletSpeed?: OverrideData<Range<number>>;
	readonly maxBounces?: OverrideData<Range<number>>;
	readonly chance?: number | Range<number>;
	readonly radius?: Range<number>;
	readonly count?: Range<number>;
	readonly canFireWhileSprinting?: OverrideData<ActionFireMode>;
	readonly canFireWhileJumping?: OverrideData<boolean>;
	readonly canFireWhileSliding?: OverrideData<ActionFireMode>;
	readonly canAimWhileSliding?: OverrideData<ActionFireMode>;
	readonly damage?: Range<number> | OverrideData<Range<number>>;
	readonly size?: Range<number> | OverrideData<Range<number>>;
	readonly burstSize?: Range<number> | OverrideData<Range<number>>;
	readonly burstFireInterval?: OverrideData<Range<number>>;
	readonly fireInterval?: Range<number> | OverrideData<Range<number>>;
	readonly hitForce?: OverrideData<Range<number>>;
	readonly ammoCapacity?: OverrideData<Range<number>>;
	readonly flags?: Flags;
	readonly speedMult?: Range<number>;
	readonly effectType?: OverrideData<number>;
	readonly effectAmount?: Range<number> | OverrideData<Range<number>>;
	readonly bulletsPerShot?: OverrideData<Range<number>>;
	readonly chargeDuration?: OverrideData<Range<number>>;
	readonly chargeCoolDownSpeed?: OverrideData<Range<number>>;
	readonly automatic?: OverrideData<number>;
	readonly damageMultiplier?: Range<number>;
	readonly canAim?: OverrideData<boolean>;
	readonly aimFOV?: OverrideData<number>;
	readonly fireIntervalMultiplier?: Range<number>;
	readonly magazineSize?: OverrideData<Range<number>>;
	readonly recoilX?: OverrideData<Range<Vector2>>;
	readonly recoilY?: OverrideData<Range<Vector2>>;
	readonly recoilZ?: OverrideData<Range<Vector2>>;
	readonly recoilSpeed?: OverrideData<Range<number>>;
	readonly spreadSize?: OverrideData<Range<Vector2>>;
	readonly spreadType?: OverrideData<number>;
	readonly fireIntervalMult?: Range<number>;
	readonly muzzleFlash?: BurstEffect;
	readonly ammo?: Range<number>;
	readonly recoil?: Range<number> | OverrideData<Range<Vector2>>;
	readonly falloffStartDistance?: OverrideData<Range<number>>;
	readonly falloffEndDistance?: OverrideData<Range<number>>;
	readonly maxDamageRange?: OverrideData<Range<number>>;
	readonly maxFalloffDamageMultiplier?: OverrideData<Range<number>>;
	readonly stackMultiplier?: Range<number>;
	readonly useSpeed?: number;
	readonly reloadDuration?: OverrideData<Range<number>>;
	readonly charge?: Range<number>;
	readonly storedAmmoCollectMultiplier?: OverrideData<Range<number>>;
	readonly force?: Range<number> | OverrideData<Range<number>>;
	readonly radiusMult?: Range<number>;
	readonly minSpread?: Range<number>;
	readonly stacksOnKill?: Range<number>;
	readonly explosionSize?: Range<number>;
	readonly ignitedReloadDurationMultiplier?: Range<number>;
	readonly selfFireAmount?: Range<number>;
	readonly ammoOnKill?: Range<number>;
	readonly ignitedFireIntervalMultiplier?: Range<number>;
	readonly slideDamageMultiplier?: Range<number>;
	readonly range?: Range<number>;
	readonly addedRange?: Range<number>;
	readonly spreadMultiplier?: Range<number>;
	readonly effect?: number | OverrideData<number>;
	readonly amount?: Range<number>;
	readonly chargeSpeed?: Range<number>;
	readonly healing?: Range<number>;
	readonly knockback?: Range<number> | OverrideData<Range<number>>;
	readonly clusterSplitCount?: Range<number>;
	readonly outgoingDamageMultiplier?: Range<number>;
	readonly incomingDamageMultiplier?: Range<number>;
	readonly rechargeDuration?: OverrideData<Range<number>>;
	readonly maxCharges?: OverrideData<Range<number>>;
	readonly health?: Range<number>;
	readonly efficiency?: Range<number>;
	readonly rechargeChance?: Range<number>;
	readonly killChance?: Range<number>;
	readonly chanceIncrease?: Range<number>;
	readonly damageMult?: Range<number>;
	readonly selfEffectMultiplier?: OverrideData<Range<number>>;
	readonly value?: Range<number>;
	readonly rarity?: number;
	readonly ammoEfficiency?: Range<number>;
	readonly cooldownDuration?: Range<number> | OverrideData<Range<number>>;
	readonly flySpeed?: OverrideData<Range<number>>;
	readonly speedIncrease?: Range<number>;
	readonly salvoDamage?: OverrideData<Range<number>>;
	readonly salvoEffect?: OverrideData<number>;
	readonly salvoEffectAmount?: OverrideData<Range<number>>;
	readonly atRocketPos?: boolean;
	readonly damageThreshold?: Range<number>;
	readonly rawDamage?: Range<number>;
	readonly minDamage?: Range<number>;
	readonly maxDamage?: Range<number>;
	readonly length?: OverrideData<Range<number>>;
	readonly laserChargeCapacity?: OverrideData<Range<number>>;
	readonly laserChargeOnHit?: OverrideData<Range<number>>;
	readonly laserChargeUsePerSecond?: OverrideData<Range<number>>;
	readonly laserAmmoRefill?: OverrideData<Range<number>>;
	readonly maxMagazineSizeMultiplierFromAmmoRefill?: OverrideData<Range<number>>;
	readonly ammoOnFire?: OverrideData<Range<number>>;
	readonly ammoReturned?: Range<number>;
	readonly maxDistance?: OverrideData<Range<number>>;
	readonly slideSpeed?: Range<number>;
	readonly multiplier?: Range<number>;
	readonly globblometer?: number | Range<number>;
	readonly chargeMultiplierOnFire?: OverrideData<Range<number>>;
	readonly fireWhenFullyCharged?: OverrideData<boolean>;
	readonly fireOnRelease?: OverrideData<boolean>;
	readonly bulletShakeTranslation?: OverrideData<Range<number>>;
	readonly bulletShakeRotation?: OverrideData<Range<number>>;
	readonly damageResistance?: Range<number>;
	readonly bulletMagnetismSurface?: OverrideData<Range<number>>;
	readonly bulletMagnetismTarget?: OverrideData<Range<number>>;
	readonly catchRecoil?: OverrideData<Range<number>>;
	readonly shotSize?: Range<number>;
	readonly clip?: AnimationClip;
	readonly chargeTimePerAmmo?: Range<number>;
	readonly sizePerAmmo?: Range<number>;
	readonly prefab?: GameObject;
	readonly spawnMode?: number;
	readonly shield?: GameObject;
	readonly uniformSvale?: boolean;
	readonly sizeX?: OverrideData<Range<number>>;
	readonly sizeY?: OverrideData<Range<number>>;
	readonly raiseFromGround?: OverrideData<boolean>;
	readonly forceDepth?: OverrideData<Range<number>>;
	readonly pushForce?: OverrideData<Range<number>>;
	readonly blastForce?: OverrideData<Range<number>>;
	readonly outwardForce?: OverrideData<boolean>;
	readonly backBoost?: OverrideData<Range<number>>;
	readonly blastArea?: OverrideData<Range<number>>;
	readonly blastDamage?: OverrideData<Range<number>>;
	readonly blastEffect?: OverrideData<number>;
	readonly chargeMultiplier?: Range<number>;
	readonly explosionRadius?: OverrideData<Range<number>>;
	readonly fuelOnFire?: Range<number>;
	readonly fuelOnAirKill?: OverrideData<Range<number>>;
	readonly chargeOnDamage?: Range<number> | OverrideData<Range<number>>;
	readonly fuelUseSpeed?: OverrideData<Range<number>>;
	readonly maxSalvoLocks?: OverrideData<Range<number>>;
	readonly lockOnInterval?: OverrideData<Range<number>>;
	readonly ammoSiphon?: Range<number>;
	readonly lockRadius?: OverrideData<Range<number>>;
	readonly shake?: OverrideData<Range<number>>;
	readonly trackForce?: OverrideData<Range<number>>;
	readonly offsetMultiplier?: OverrideData<Range<number>>;
	readonly lockFlyDirection?: OverrideData<boolean>;
	readonly flyLookSensitivityMultiplier?: OverrideData<number>;
	readonly salvoHealing?: OverrideData<Range<number>>;
	readonly efficacyPerCancel?: Range<number>;
	readonly ammoPerSecond?: Range<number>;
	readonly chargePerAmmo?: Range<number>;
	readonly ammoRefilled?: Range<number>;
	readonly maxReloadInterval?: Range<number>;
	readonly interval?: Range<number>;
	readonly moreDmgChance?: Range<number>;
	readonly dmgSelfChance?: Range<number>;
	readonly selfDamage?: Range<number>;
	readonly reloadDurationMultiplier?: Range<number>;
	readonly ammoPerStack?: Range<number>;
	readonly bullet?: GameObject;
	readonly trackingRadius?: Range<number>;
	readonly addedAcidPerSecond?: Range<number>;
	readonly addedRecoilPerSecond?: Range<number>;
	readonly increasedFire?: Range<number>;
	readonly fireIntervalEfficiency?: Range<number>;
	readonly damageReduction?: Range<number> | OverrideData<Range<number>>;
	readonly aimRecoilMultiplier?: Range<number>;
	readonly fireAmount?: Range<number>;
	readonly combustChance?: Range<number>;
	readonly energyMultiplier?: Range<number>;
	readonly healingCharge?: Range<number>;
	readonly maxBlood?: OverrideData<Range<number>>;
	readonly bloodOnKill?: OverrideData<Range<number>>;
	readonly chargeOnOverload?: OverrideData<Range<number>>;
	readonly explodeInterval?: Range<number>;
	readonly up?: Range<number>;
	readonly refillLastShotChance?: Range<number>;
	readonly limbDamage?: Range<number>;
	readonly shellDamage?: Range<number>;
	readonly healAmount?: OverrideData<Range<number>>;
	readonly dropChance?: OverrideData<Range<number>>;
	readonly switchInterval?: Range<number>;
	readonly damageMultPerStack?: Range<number>;
	readonly bullets?: Range<number>;
	readonly aimRange?: Range<number>;
	readonly overheatSpeed?: OverrideData<Range<number>>;
	readonly fireRate?: number | Range<number>;
	readonly rageOnKill?: Range<number>;
	readonly threshold?: Range<number>;
	readonly airDamageMult?: Range<number>;
	readonly groundDamageMult?: Range<number>;
	readonly reloadSpeed?: number;
	readonly damageResist?: Range<number>;
	readonly maxSize?: Range<number>;
	readonly chargePerSecond?: Range<number>;
	readonly multiplierPerDamageTaken?: Range<number>;
	readonly sizePerSecond?: Range<number>;
	readonly maxPoles?: OverrideData<Range<number>>;
	readonly durationPerUpgrade?: Range<number>;
	readonly minFireIntervalMultiplier?: OverrideData<Range<number>>;
	readonly spinUpSpeed?: OverrideData<Range<number>>;
	readonly moveSpeed?: Range<number>;
	readonly recallSpeed?: OverrideData<Range<number>>;
	readonly laserCharge?: Range<number>;
	readonly damageTaken?: Range<number>;
	readonly chargeUseMultiplier?: Range<number>;
	readonly minCharge?: Range<number>;
	readonly chargeEfficiency?: Range<number>;
	readonly explosionDamage?: Range<number>;
	readonly speedMultiplier?: Range<number>;
	readonly minInterval?: Range<number>;
	readonly refundChance?: Range<number>;
	readonly ammoCount?: Range<number>;
	readonly fireSound?: Event;
	readonly ammoRegen?: OverrideData<Range<number>>;
	readonly translate?: OverrideData<Range<number>>;
	readonly maxTranslate?: OverrideData<Range<number>>;
	readonly healthPerAmmo?: Range<number>;
	readonly ammoCost?: Range<number>;
	readonly magSize?: OverrideData<Range<number>>;
	readonly preset?: GameObject;
}

export interface Range<T> {
	readonly min: T;
	readonly max: T;
}

export interface OverrideData<T> {
	readonly data: T;
	readonly method: OverrideType;
}

export interface Event {
	readonly idInternal: number;
	readonly WwiseObjectReference: WwiseEventReference;
}

export interface Flags {
	readonly flags: number;
}

export interface Vector2 {
	readonly x: number;
	readonly y: number;
}
