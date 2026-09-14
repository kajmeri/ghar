import type { AssetKindValue } from '@ghar/contracts'
import { Car, Fan, House, Package, Tv, WashingMachine, type LucideIcon } from 'lucide-react'

export const ASSET_ICONS: Record<AssetKindValue, LucideIcon> = {
  vehicle: Car,
  appliance: WashingMachine,
  system: Fan,
  electronics: Tv,
  property: House,
  other: Package,
}
