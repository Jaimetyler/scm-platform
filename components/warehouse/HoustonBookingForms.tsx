import type { ReactNode } from "react";
import { outboundSteamshipLine } from "@/lib/warehouse/outbound/booking-identifiers";
import { formatBookingDate } from "@/lib/warehouse/outbound/details";

export type HoustonFormData = {
  booking: {
    booking_number: string;
    customer: string;
    steamship_line: string | null;
    vessel: string | null;
    return_location: string | null;
    cutoff: string | null;
    cutoff_has_time: boolean;
    scm_file_number: string | null;
    planned_containers: number | null;
  };
  lines: { id: string; line_status: string; mark: string; requested_bales: number }[];
  containers: {
    booking_line_id: string | null;
    split_transfer_id: string | null;
    container_number: string | null;
    seal_number: string | null;
    carrier_name: string | null;
  }[];
};

function Letterhead({ title }: { title: string }) {
  return <header className="hou-form-letterhead">
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src="/scm-logo.png" width="156" height="50" alt="SCM Supply Chain Management LLC" />
    <div>4331 UNDERWOOD RD, SUITE 200 · PASADENA, TX 77507</div>
    <div>(912) 443-4008 EXT 4711</div>
    <h1>{title}</h1>
  </header>;
}

function Field({ label, children }: { label: string; children?: ReactNode }) {
  return <div className="hou-form-field"><strong>{label}</strong><span>{children}</span></div>;
}

export default function HoustonBookingForms({ booking, lines, containers, manifest, date }:
  HoustonFormData & { manifest: boolean; date: string }) {
  const activeMarks = lines.filter(line => line.line_status === "active");
  const activeIds = new Set(activeMarks.map(line => line.id));
  const equipment = containers.filter(row => !row.split_transfer_id && (!row.booking_line_id || activeIds.has(row.booking_line_id)));
  const line = outboundSteamshipLine(booking.steamship_line, booking.booking_number);
  const cutoff = booking.cutoff ? formatBookingDate(booking.cutoff, booking.cutoff_has_time) : null;

  if (manifest) {
    if (!activeMarks.length) return <p role="status">This booking has no active marks to print.</p>;
    const [vessel, voyage] = (booking.vessel ?? "").split(/\s+\/\s+/);
    return activeMarks.map(mark => {
      const row = equipment.find(item => item.booking_line_id === mark.id);
      return <article className="hou-form-page hou-manifest" key={mark.id}>
        <div className="hou-form-pair"><Field label="CUT OFF">{cutoff}</Field><Field label="FILE #">{booking.scm_file_number}</Field></div>
        <Letterhead title="CONTAINER MANIFEST" />
        <div className="hou-form-pair"><Field label="SHIPPER">{booking.customer}</Field><Field label="DATE">{date}</Field></div>
        <Field label="STEAMSHIP COMPANY">{line}</Field>
        <div className="hou-form-pair"><Field label="# BALES OF COTTON">{mark.requested_bales}</Field><Field label="APPROX. WT.">45,000 LBS</Field></div>
        <Field label="MARK">{mark.mark}</Field>
        <Field label="PORT">{booking.return_location}</Field>
        <Field label="BOOKING #">{booking.booking_number}</Field>
        <div className="hou-form-pair"><Field label="VESSEL">{voyage ? vessel : booking.vessel}</Field><Field label="VG #">{voyage}</Field></div>
        <Field label="CONTAINER">{row?.container_number}</Field>
        <Field label="SEAL #">{row?.seal_number ?? "UL-"}</Field>
        <div className="hou-form-dispatch">
          <div className="hou-form-pair"><Field label="TRUCK COMPANY">{row?.carrier_name ?? "SCM INTERMODAL"}</Field><Field label="DATE" /></div>
          <div className="hou-form-pair"><Field label="DRIVER" /><Field label="TRUCK #" /></div>
        </div>
      </article>;
    });
  }

  const count = booking.planned_containers ?? (equipment.length || activeMarks.length);
  return Array.from({ length: Math.max(1, Math.ceil(count / 40)) }, (_, page) => {
    const offset = page * 40;
    const slots = Math.min(40, count - offset);
    return <article className="hou-form-page" key={page}>
      <Letterhead title="REQUEST FOR EMPTIES" />
      <div className="hou-form-pair">
        <div>
          <div className="hou-form-field" aria-hidden="true" />
          <Field label="BOOKING #">{booking.booking_number}</Field>
          <Field label="VESSEL">{booking.vessel}</Field>
          <Field label="NUMBER">{count}</Field>
        </div>
        <div>
          <Field label="DATE">{date}</Field>
          <Field label="LINE">{line}</Field>
          <Field label="CUT OFF">{cutoff}</Field>
          <Field label="SIZE">40′</Field>
        </div>
      </div>
      <ol className="hou-form-slots" start={offset + 1}>
        {Array.from({ length: slots }, (_, index) => <li key={index}>{offset + index + 1}.</li>)}
      </ol>
    </article>;
  });
}
