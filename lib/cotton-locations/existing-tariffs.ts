// Previously supplied source documents. Coverage is linked only where warehouse codes/addresses match.
// On-file evidence does not approve fee rules, confirm hours, or establish that the tariff is still current.
export type ExistingTariff={fileId:string;filename:string;codes:string[];effectiveDate:string|null;note:string};
export const existingTariffs:ExistingTariff[]=[
 {fileId:"libfile_4fb4016b70b08191bc4e6be70ed143aa",filename:"Glasscock County Co-op Tariff 2026.docx",codes:["GLASGATX"],effectiveDate:"2026-09-01",note:"Warehouse 858078; Garden City address. Confirm current version and review terms."},
 {fileId:"libfile_2e452c461cec819191391b35b864ea7a",filename:"911533 HCC Plainview_(2-3118)_Tariff_2026_09_01 (2).pdf",codes:["HALEPLTX"],effectiveDate:"2026-09-01",note:"Warehouse 911533; 710 East 7th Street, Plainview."},
 {fileId:"libfile_407023477b0481919762f512116864e2",filename:"884033 HCC-Lockney_(2-3117)_Tariff_2026_09_01 (2).pdf",codes:["LOCKLOTX"],effectiveDate:"2026-09-01",note:"Warehouse 884033; 1721 West Highway 70, Lockney."},
 {fileId:"libfile_c6bc55cd48d48191b864f4290119ab2e",filename:"Tariff2026_PCCA.pdf",codes:["PLAIALOK","PLAIRUTX","PLAISWTX"],effectiveDate:"2026-08-01",note:"Explicit warehouse codes 631020, 925012 and 937530. Other listed facilities need location mapping."},
 {fileId:"libfile_5343c73ccc9c8191b7809c6ea2805241",filename:"Tariff2026-Corpus-Portland.pdf",codes:["GULFCOT1","GULFCOT2","GULFPOTX"],effectiveDate:"2026-07-01",note:"Explicit warehouse codes 840513, 840512 and 840510; corresponding plant addresses match."},
 {fileId:"libfile_200d18777e948191ba35dc107df72400",filename:"Taylor Compress Tariff2026.pdf",codes:["TAYLTAT1","TAYLTATX"],effectiveDate:"2026-07-01",note:"Explicit warehouse codes 940015 and 940025. Compare Gulf Taylor document before approving terms for the shared address."},
 {fileId:"libfile_340a5377a99881919cd853b1abc577e9",filename:"Farmers Tariff.pdf",codes:["FARMCLTX","FARMLETX","FARMLUT3","FARMLUT4","FARMLUT6","FARMLUTX","FARMSTTX"],effectiveDate:"2026-09-01",note:"Matched by explicit warehouse codes. FARMLUT2 has a conflicting Sudan code/Lubbock identity; FARMLUT5 code is not listed. Review those mappings separately."},
 {fileId:"libfile_419e995726d48191aff03d8e18b9fa87",filename:"Tariff2026-Gulf Compress Sweetwater.pdf",codes:["GULFSWTX"],effectiveDate:"2026-07-01",note:"Warehouse 840509; 303 CR 142, Sweetwater. Nearby PCCA coverage has a different warehouse code."},
 {fileId:"libfile_0ed1eeedb4508191a8785eedbf289f3c",filename:"886570 Lov-Cot Warehouse,LLC-LVC- 2-3121  26-09-01.pdf",codes:["LOVCLUTX"],effectiveDate:"2026-09-01",note:"Warehouse 886570; 2002 North Gary, Lubbock."},
 {fileId:"libfile_0cdcf798e86c81919aecd7e0fde209b4",filename:"2026 Tariff- Post.pdf",codes:[],effectiveDate:null,note:"Scanned document on file. Confirm facility identity, warehouse code and effective date before linking."},
 {fileId:"libfile_c9c788e775648191983432f1478e752a",filename:"PLAINVIEW TARIFF 2026-2027.pdf",codes:[],effectiveDate:null,note:"Scanned document on file. Confirm which Plainview facility and effective date; do not infer coverage from the filename."},
 {fileId:"libfile_d4f2a24cd72c8191b77955e654f96683",filename:"POST TARIFF 2026-2027.pdf",codes:[],effectiveDate:null,note:"Scanned document on file. Check identity and possible overlap with the other Post document."},
 {fileId:"libfile_fa4552d2647c8191a5c005e446d75d92",filename:"QUANAH TARIFF.pdf",codes:[],effectiveDate:null,note:"Scanned document on file. Confirm warehouse code, address and effective date before linking."},
 {fileId:"libfile_492fdfc4b61081918b53ca6c20679d6e",filename:"TrinityCotton_2026_Tariff.pdf",codes:[],effectiveDate:null,note:"Written tariff on file; facility mapping and effective date still need review."},
 {fileId:"libfile_cd06f08ddfa08191987b3c5af2f92ee1",filename:"Tariff2026-Gulf Taylor.pdf",codes:[],effectiveDate:"2026-07-01",note:"Lists 2000 E. 4th Street, Taylor, code 840516. TAYLTATX shares the address but has code 940025; resolve ownership/code conflict before applying."},
];
export const existingTariffUrl=(fileId:string)=>`https://chatgpt.com/library?file_id=${fileId}&account_id=personal`;
export const tariffsForLocation=(code:string)=>existingTariffs.filter(t=>t.codes.includes(code));
