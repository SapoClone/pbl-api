/** What a member is in charge of during a shift ("phụ trách"); a shift has exactly one */
export enum StaffDuty {
  /** Runs the shift: the one to call when something goes wrong */
  SHIFT_LEAD = 'shift_lead',
  /** The register and the money in it */
  CASHIER = 'cashier',
  /** Serving customers on the floor */
  SALES = 'sales',
  /** Receiving, putting away and counting stock */
  WAREHOUSE = 'warehouse',
  /** Packing and handing parcels to carriers */
  DELIVERY = 'delivery',
  OTHER = 'other',
}
