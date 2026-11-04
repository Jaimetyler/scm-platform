# Cotton location equipment and flatbed fee evidence

Locations now have a Van / Flatbed tab. Tariff Outreach includes the same editor, an equipment summary column and an equipment-review filter prioritizing TX, OK, KS and NM. The request script includes accepted equipment, fees, payer and conditions. This supplements tariff-first collection; it does not replace obtaining the current written tariff.

Accepted equipment is unknown, van-only or van-and-flatbed. Flatbed fee basis is unknown, no charge, per load, per bale or other. Unknown amounts remain null; a known zero/no-charge fee is distinct. Fee payer is shipper, carrier or unknown. Conditions hold advance-notice, appointment and seasonal exceptions. Source reference and effective date accompany the evidence. Collectors save unverified changes; administrators can confirm. Each change uses optimistic version checks and a signed-in audit actor.

The private `cotton_location_equipment` table and its audited save RPC are accessible only through server-side staff routes. The staff equipment endpoint allows active operators to collect evidence and viewers to read. Confirmation remains administrator-only. The data does not update any McLeod order charges, carrier pay or active late-fee rules.

Twenty matched location records are prefilled from nine previously supplied written tariffs: Farmers and PCCA $2/bale; HCC Plainview/Lockney, Lov-Cot and Gulf Compress $1.50/bale; Taylor $1/bale; Glasscock $3.42/bale with 48 hours' notice. These are unverified evidence entries. Payer and definitive van/flatbed acceptance remain unknown until confirmed. The Taylor/Gulf Taylor address/code conflict remains noted. McLeod names explicitly saying van-only are retained as unverified restriction clues.

The Bunge preview accepts pickup equipment for the upload (unknown/van/flatbed). Flatbed selections flag van-only restrictions, unknown acceptance, fees, payer and conditions. Unselected equipment is flagged for priority states. Fees are shown as evidence only and never added to carrier pay or billing. The selection must be reviewed per load before any future order-creation feature is enabled.
