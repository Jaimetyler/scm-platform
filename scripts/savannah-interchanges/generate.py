"""Render one Savannah truck transaction attachment into local interchange PDFs."""

import argparse
import csv
import json
import re
from pathlib import Path

from fpdf import FPDF


def translate_terminal(value):
    if value == 'GCT':
        return "Georgia Ports Authority - Savannah"
    elif value == 'OT':
        return "Ocean Terminal - GPA Savannah"
    return value

# Function to translate Trucking Company Id
def translate_trucking_company(value):
    if value is None:
        return ""
    if value == 'SCQW':
        return "SCQW - SCM Intermodal"
    return value

# Function to translate Chassis Ownership
def translate_chassis_ownership(value):
    if value is None:
        return ""
    if value.lower() == 'yes':
        return "Private Chassis"
    elif value.lower() == 'no':
        return "Pool Chassis"
    return ""

# Function to translate Transaction Type
def translate_transaction_type(value):
    transaction_types = {
        'DM': 'OutGate - Deliver Empty',
        'RM': 'InGate - Receive Empty',
        'DI': 'OutGate - Deliver Import',
        'RE': 'InGate - Receive Export',
        'DE': 'InGate - Deliver Export',
        'RC': 'InGate - Receive Chassis',
        'DC': 'OutGate - Deliver Chassis'
    }
    return transaction_types.get(value, value)

def get_transaction_action(value):
    transaction_actions = {
        'DM': 'out',
        'RM': 'in',
        'DI': 'out',
        'RE': 'in',
        'DE': 'in',
        'RC': 'in',
        'DC': 'out'
    }
    return transaction_actions.get(value, '')
def render_pdf(record, image_path):
    pdf = FPDF()
    pdf.add_page()

    # Add image as header
    pdf.image(image_path, x=10, y=8, w=50)
    pdf.ln(30)  # Move below the header image

    pdf.set_font("Helvetica", 'B', 14)
    terminal_text = translate_terminal(str(record.get('TERMINAL', '')))
    pdf.cell(200, 10, text=terminal_text, new_x="LMARGIN", new_y="NEXT", align='C')

    pdf.set_font("Helvetica", 'B', 10)
    entered_yard_text = f"Date: {str(record.get('ENTERED_YARD', ''))}"
    pdf.cell(200, 10, text=entered_yard_text, new_x="LMARGIN", new_y="NEXT", align='C')

    pdf.set_font("Helvetica", size=10)
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.ln(10)  # Add a line break

    left_headers = [
        ('LINE', 'SSL: '),
        ('BOOKING', 'Booking Number: '),
        ('CTR NBR', 'Container Number: '),
        ('CHS NBR', 'Chassis Number: '),
        ('CHS_IS_OWNERS', ''),
        ('SEAL_NBR1', 'Seal: '),
        ('CARGO_WT', 'Cargo Weight (LBS): '),
        ('TRUCKING COMPANY ID', 'Trucking Company: '),
        ('LICENSE_NBR', 'Truck ID: ')
    ]

    right_headers = [
        ('TRANSACTION NBR', 'EIR: '),
        ('PIN', 'Pin: '),
        ('TRANSACTION TYPE', 'Transaction Type: '),
        ('STATUS', 'Status: '),
    ]

    # Left side headers
    left_x = 10
    left_y = 80
    pdf.set_xy(left_x, left_y)
    for original, display in left_headers:
        if original == 'CHS_IS_OWNERS':
            continue
        value = record.get(original, '')
        if original == 'CHS NBR':
            ownership_value = translate_chassis_ownership(record.get('CHS_IS_OWNERS', ''))
            if ownership_value:
                text = f"{display} {value} - {ownership_value}"
            else:
                text = f"{display} {value}"
        elif original == 'TRUCKING COMPANY ID':
            value = translate_trucking_company(value)
            text = f"{display} {value}"
        elif original == 'BOOKING' and value:
            value = value.split('.')[0]  # Remove decimal part
            text = f"{display} {value}"
        else:
            text = f"{display} {value}"
        pdf.cell(90, 10, text=text, new_x="LMARGIN", new_y="NEXT")

    # Right side headers
    right_x = 110
    right_y = left_y
    for original, display in right_headers:
        value = record.get(original, '')
        if original == 'TRANSACTION TYPE':
            value = translate_transaction_type(value)
        text = f"{display} {value}"
        pdf.set_xy(right_x, right_y)
        pdf.cell(90, 10, text=text, new_x="LMARGIN", new_y="NEXT")
        right_y += 10  # Move to the next line for each field

    # Add Size field at the bottom of the right side
    size_value = record.get('SZTPHT', '')
    size_text = f"Size: {size_value}"
    pdf.set_xy(right_x, right_y)
    pdf.cell(90, 10, text=size_text, new_x="LMARGIN", new_y="NEXT")

    return bytes(pdf.output())


def generate(report_path, output_dir, logo_path):
    with report_path.open(encoding="utf-8-sig", newline="") as report:
        reader = csv.DictReader(report)
        required = {"TRANSACTION TYPE", "CTR NBR", "BOOKING", "TRANSACTION NBR", "ENTERED_YARD", "TERMINAL"}
        if not required.issubset(reader.fieldnames or []):
            raise ValueError("The CSV is missing required truck transaction columns.")
        records = {}
        for row_number, row in enumerate(reader, start=2):
            if None in row or any(value is None for value in row.values()):
                raise ValueError(f"Invalid CSV row width on line {row_number}.")
            container = row["CTR NBR"].strip().upper()
            if not container:
                continue
            action = get_transaction_action(row["TRANSACTION TYPE"].strip().upper())
            booking = row["BOOKING"].strip().split(".")[0]
            if not action or not re.fullmatch(r"[A-Z]{4}[0-9]{7}", container):
                raise ValueError(f"Unknown transaction type or invalid container on line {row_number}.")
            if booking and not re.fullmatch(r"[A-Za-z0-9_-]+", booking):
                raise ValueError(f"Invalid booking on line {row_number}.")
            root = Path("exports", booking) if booking else Path("imports")
            relative = root / f"{container}_{action}.pdf"
            row.update({"CTR NBR": container, "BOOKING": booking, "TRANSACTION TYPE": row["TRANSACTION TYPE"].strip().upper()})
            if relative in records and records[relative] != row:
                raise ValueError(f"Conflicting transactions for the same output on line {row_number}.")
            records[relative] = row

    if not records:
        raise ValueError("The report contains no interchange records.")
    if output_dir.exists():
        raise FileExistsError("Use a fresh output directory for this report.")
    documents = {key: render_pdf(value, logo_path) for key, value in records.items()}
    output_dir.mkdir(parents=True)
    for relative, pdf in documents.items():
        destination = output_dir / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(pdf)
    return [path.as_posix() for path in documents]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("logo", type=Path)
    args = parser.parse_args()
    print(json.dumps({"files": generate(args.report, args.output, args.logo)}))
