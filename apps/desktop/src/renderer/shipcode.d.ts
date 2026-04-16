import type { ShipCodeAPI } from '@shipcode/shared';

declare global {
  interface Window {
    shipcode: ShipCodeAPI;
  }
}
