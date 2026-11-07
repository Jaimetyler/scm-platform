-- Browsers upload large workbooks directly; staff APIs receive only a signed receipt.
-- No public/authenticated policies: object access is through short-lived, scoped signed URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('outbound-booking-uploads','outbound-booking-uploads',false,26214400,
  array['application/octet-stream','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel.sheet.binary.macroEnabled.12']);
