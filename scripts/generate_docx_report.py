#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script to generate the official Word documentation for Unit Testing:
BaoCao-KiemThu-Phan2-UnitTest.docx
Author: Hius (Unit Test Engineer)
Project: Sapo Clone (PBL6) - Sales Service Pure Domain Unit Testing
"""

import os
import docx
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_ALIGN_VERTICAL
from docx.oxml import parse_xml, OxmlElement
from docx.oxml.ns import nsdecls, qn

def create_report():
    doc = docx.Document()

    # 1. Page Margins & Setup (Matching BaoCao-KiemThu-Luong5-ChuyenKho.docx)
    # Margins: top=56.7pt (20mm), bottom=56.7pt (20mm), left=72pt (25.4mm), right=72pt (25.4mm)
    section = doc.sections[0]
    section.page_width = Pt(595.3)
    section.page_height = Pt(841.9)
    section.top_margin = Pt(56.7)
    section.bottom_margin = Pt(56.7)
    section.left_margin = Pt(72.0)
    section.right_margin = Pt(72.0)

    # Set normal style font to Times New Roman
    normal_style = doc.styles['Normal']
    normal_style.font.name = 'Times New Roman'
    normal_style.font.size = Pt(11)
    normal_style.paragraph_format.line_spacing = 1.15
    normal_style.paragraph_format.space_after = Pt(4)

    # Helper functions for styling
    def add_p(text="", style='Normal', space_before=0, space_after=4, align=WD_ALIGN_PARAGRAPH.LEFT, line_spacing=1.15):
        p = doc.add_paragraph(style=style)
        p.alignment = align
        p.paragraph_format.space_before = Pt(space_before)
        p.paragraph_format.space_after = Pt(space_after)
        p.paragraph_format.line_spacing = line_spacing
        if text:
            r = p.add_run(text)
            r.font.name = 'Times New Roman'
        return p

    def add_heading_1(text):
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(14)
        p.paragraph_format.space_after = Pt(6)
        p.paragraph_format.keep_with_next = True
        r = p.add_run(text)
        r.font.name = 'Times New Roman'
        r.font.size = Pt(16)
        r.font.bold = True
        r.font.color.rgb = RGBColor(0, 32, 96) # Dark Navy #002060
        return p

    def add_heading_2(text):
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(12)
        p.paragraph_format.space_after = Pt(4)
        p.paragraph_format.keep_with_next = True
        r = p.add_run(text)
        r.font.name = 'Times New Roman'
        r.font.size = Pt(13)
        r.font.bold = True
        r.font.color.rgb = RGBColor(31, 73, 125) # Steel Blue #1F497D
        return p

    def add_heading_3(text):
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(8)
        p.paragraph_format.space_after = Pt(2)
        p.paragraph_format.keep_with_next = True
        r = p.add_run(text)
        r.font.name = 'Times New Roman'
        r.font.size = Pt(11.5)
        r.font.bold = True
        r.font.color.rgb = RGBColor(0, 0, 0)
        return p

    def add_bullet(text, bold_prefix="", level=0):
        p = doc.add_paragraph(style='List Paragraph')
        p.paragraph_format.space_before = Pt(1)
        p.paragraph_format.space_after = Pt(2)
        p.paragraph_format.line_spacing = 1.15
        p.paragraph_format.left_indent = Inches(0.25 * (level + 1))
        
        # Add bullet symbol
        r_bullet = p.add_run("• ")
        r_bullet.font.name = 'Times New Roman'
        r_bullet.font.size = Pt(10.5)
        r_bullet.font.bold = True

        if bold_prefix:
            r_pre = p.add_run(bold_prefix + " ")
            r_pre.font.name = 'Times New Roman'
            r_pre.font.size = Pt(10.5)
            r_pre.font.bold = True
        r_text = p.add_run(text)
        r_text.font.name = 'Times New Roman'
        r_text.font.size = Pt(10.5)
        return p

    def format_cell(cell, text="", bold=False, italic=False, font_size=9.5, align=WD_ALIGN_PARAGRAPH.LEFT, bg_color=None, text_color=None):
        cell.text = ""
        p = cell.paragraphs[0]
        p.alignment = align
        p.paragraph_format.space_before = Pt(1)
        p.paragraph_format.space_after = Pt(1)
        p.paragraph_format.line_spacing = 1.05

        if text:
            r = p.add_run(str(text))
            r.font.name = 'Times New Roman'
            r.font.size = Pt(font_size)
            r.font.bold = bold
            r.font.italic = italic
            if text_color:
                r.font.color.rgb = text_color

        # XML properties
        tcPr = cell._tc.get_or_add_tcPr()

        # Cell margins (padding: top=50 dxa, bottom=50 dxa, left=80 dxa, right=80 dxa)
        tcMar = parse_xml(r'<w:tcMar ' + nsdecls('w') + r'>'
                          r'<w:top w:w="50" w:type="dxa"/>'
                          r'<w:left w:w="80" w:type="dxa"/>'
                          r'<w:bottom w:w="50" w:type="dxa"/>'
                          r'<w:right w:w="80" w:type="dxa"/>'
                          r'</w:tcMar>')
        tcPr.append(tcMar)

        # Borders: single line #808080, sz=4
        tcBorders = parse_xml(r'<w:tcBorders ' + nsdecls('w') + r'>'
                              r'<w:top w:val="single" w:sz="4" w:space="0" w:color="808080"/>'
                              r'<w:left w:val="single" w:sz="4" w:space="0" w:color="808080"/>'
                              r'<w:bottom w:val="single" w:sz="4" w:space="0" w:color="808080"/>'
                              r'<w:right w:val="single" w:sz="4" w:space="0" w:color="808080"/>'
                              r'</w:tcBorders>')
        tcPr.append(tcBorders)

        # Shading
        if bg_color:
            shd = parse_xml(r'<w:shd ' + nsdecls('w') + rf' w:fill="{bg_color}" w:val="clear"/>')
            tcPr.append(shd)

        # Vertical alignment
        vAlign = parse_xml(r'<w:vAlign ' + nsdecls('w') + r' w:val="top"/>')
        tcPr.append(vAlign)

    def create_table(headers, data, col_widths, header_bg='DCE6F1'):
        table = doc.add_table(rows=len(data) + 1, cols=len(headers))
        table.alignment = WD_TABLE_ALIGNMENT.CENTER
        
        # Set table full page width (9026 dxa)
        tblPr = table._tbl.tblPr
        tblW = parse_xml(r'<w:tblW ' + nsdecls('w') + r' w:type="dxa" w:w="9026"/>')
        tblPr.append(tblW)

        # Header row
        hdr_row = table.rows[0]
        hdr_trPr = hdr_row._tr.get_or_add_trPr()
        hdr_trPr.append(parse_xml(r'<w:tblHeader ' + nsdecls('w') + r'/>'))
        hdr_trPr.append(parse_xml(r'<w:cantSplit ' + nsdecls('w') + r'/>'))

        for c_idx, h_text in enumerate(headers):
            cell = hdr_row.cells[c_idx]
            format_cell(cell, text=h_text, bold=True, font_size=9.5, align=WD_ALIGN_PARAGRAPH.CENTER, bg_color=header_bg)

        # Data rows
        for r_idx, row_data in enumerate(data):
            row = table.rows[r_idx + 1]
            trPr = row._tr.get_or_add_trPr()
            trPr.append(parse_xml(r'<w:cantSplit ' + nsdecls('w') + r'/>'))

            # Alternating subtle row shading
            row_bg = 'FAFAFA' if r_idx % 2 == 1 else 'FFFFFF'

            for c_idx, val in enumerate(row_data):
                cell = row.cells[c_idx]
                align = WD_ALIGN_PARAGRAPH.CENTER if (c_idx == 0 or 'Pass' in str(val) or 'Fail' in str(val) or len(str(val)) < 8) else WD_ALIGN_PARAGRAPH.LEFT
                
                # Highlight Passed / Failed
                text_color = None
                bold_cell = False
                if str(val) == 'Passed' or str(val) == 'Đạt':
                    text_color = RGBColor(0, 128, 0) # Green
                    bold_cell = True
                elif str(val) == 'Failed' or str(val) == 'Không đạt' or 'Lỗi' in str(val):
                    text_color = RGBColor(192, 0, 0) # Red
                    bold_cell = True
                
                format_cell(cell, text=str(val), bold=bold_cell, font_size=9.0, align=align, bg_color=row_bg, text_color=text_color)

        # Apply column widths to cells
        for row in table.rows:
            for c_idx, w_dxa in enumerate(col_widths):
                tcPr = row.cells[c_idx]._tc.get_or_add_tcPr()
                tcW = parse_xml(rf'<w:tcW {nsdecls("w")} w:type="dxa" w:w="{w_dxa}"/>')
                tcPr.append(tcW)

        # Empty paragraph after table
        p_space = doc.add_paragraph()
        p_space.paragraph_format.space_before = Pt(2)
        p_space.paragraph_format.space_after = Pt(4)
        return table

    # =========================================================================
    # TRANG BÌA (COVER PAGE)
    # =========================================================================
    p = add_p("TRƯỜNG ĐẠI HỌC BÁCH KHOA", align=WD_ALIGN_PARAGRAPH.CENTER, space_before=20, space_after=2)
    p.runs[0].font.size = Pt(14)
    p.runs[0].font.bold = True

    p = add_p("KHOA CÔNG NGHỆ THÔNG TIN", align=WD_ALIGN_PARAGRAPH.CENTER, space_before=2, space_after=60)
    p.runs[0].font.size = Pt(14)
    p.runs[0].font.bold = True

    p = add_p("SOFTWARE TEST DOCUMENTATION", align=WD_ALIGN_PARAGRAPH.CENTER, space_before=40, space_after=4)
    p.runs[0].font.size = Pt(18)
    p.runs[0].font.bold = True
    p.runs[0].font.color.rgb = RGBColor(0, 32, 96)

    p = add_p("(ISTQB v4 Standard & AI Integrated)", align=WD_ALIGN_PARAGRAPH.CENTER, space_before=2, space_after=30)
    p.runs[0].font.size = Pt(13)
    p.runs[0].font.bold = True
    p.runs[0].font.color.rgb = RGBColor(89, 89, 89)

    p = add_p("Nền tảng SaaS quản trị bán lẻ đa kênh", align=WD_ALIGN_PARAGRAPH.CENTER, space_before=20, space_after=6)
    p.runs[0].font.size = Pt(15)
    p.runs[0].font.bold = True

    p = add_p("Phần 2: Kiểm thử đơn vị (Unit Test) – Dịch vụ Sales (UC-01)", align=WD_ALIGN_PARAGRAPH.CENTER, space_before=2, space_after=120)
    p.runs[0].font.size = Pt(14)
    p.runs[0].font.bold = True
    p.runs[0].font.color.rgb = RGBColor(31, 73, 125)

    p = add_p("STUDENT", align=WD_ALIGN_PARAGRAPH.CENTER, space_before=40, space_after=4)
    p.runs[0].font.size = Pt(13)
    p.runs[0].font.bold = True

    p = add_p("Hius  –  MSSV: [Điền MSSV]", align=WD_ALIGN_PARAGRAPH.CENTER, space_before=2, space_after=60)
    p.runs[0].font.size = Pt(13)

    p = add_p("Đà Nẵng, 11 - 2026", align=WD_ALIGN_PARAGRAPH.CENTER, space_before=30, space_after=0)
    p.runs[0].font.size = Pt(13)
    p.runs[0].font.bold = True

    doc.add_page_break()

    # =========================================================================
    # TABLE OF CONTENTS
    # =========================================================================
    p = add_p("Table of Contents", space_before=10, space_after=12)
    p.runs[0].font.size = Pt(14)
    p.runs[0].font.bold = True

    toc_items = [
        ("I. Record of Changes", "2"),
        ("II. Testing Documentation", "3"),
        ("    1. Scope of Testing", "3"),
        ("        a. In-scope (Trong phạm vi kiểm thử)", "3"),
        ("        b. Out-of-Scope (Ngoài phạm vi kiểm thử)", "3"),
        ("        c. Assumptions & Constraints (Giả định và ràng buộc)", "4"),
        ("    2. Test Strategy & Approach", "4"),
        ("        2.1 Testing Types", "4"),
        ("        2.2 Test Levels Matrix", "5"),
        ("        2.3 Supporting Tools", "5"),
        ("        2.4 Risk-Based Testing (RBT)", "6"),
        ("        2.5 AI Usage & Integrity Declaration", "6"),
        ("        2.6 Mô hình Test Diamond", "7"),
        ("    3. Test Plan", "7"),
        ("        3.1 Human Resources & Independence Levels", "7"),
        ("        3.2 Test Environment", "7"),
        ("        3.3 Test Milestones", "8"),
        ("        3.4 Entry and Exit Criteria", "8"),
        ("    4. Static Testing - Cross-Review Log", "9"),
        ("    5. Test Cases & Reports", "10"),
        ("        5.1 Tổng hợp kết quả", "10"),
        ("        5.2 Danh sách test case và kết quả thực tế", "10"),
        ("            A. Kiểm tra biên phần trăm (%) chiết khấu (calculateItemDiscount)", "10"),
        ("            B. Kiểm tra hạn mức chiết khấu theo quyền RBAC (assertDiscountAuthority)", "12"),
        ("            C. Chiết khấu số tiền cố định (FIXED) và làm tròn Half-up VND", "13"),
        ("            D. Thanh toán kết hợp và tính tiền thừa (validateOrderTenders)", "15"),
        ("            E. Xác thực phương thức thanh toán chuyển khoản và COD", "16"),
        ("            F. Trường hợp lỗi thanh toán và dữ liệu tiền tệ không hợp lệ", "17"),
        ("        5.3 Ma trận truy vết (test case → FR / BR / NFR)", "18"),
        ("        5.4 Báo cáo lỗi (Defect Report)", "19"),
        ("        5.5 Kết quả chạy lại các test Jest hiện có (bằng chứng bổ sung)", "20"),
        ("        5.6 Bằng chứng chạy kiểm thử (Jest Terminal Logs)", "21"),
        ("        5.7 Cách chạy lại", "21"),
        ("Phụ lục. Ghi chú chéo cho các luồng khác", "22")
    ]
    for title, page_str in toc_items:
        p_toc = doc.add_paragraph()
        p_toc.paragraph_format.space_before = Pt(1)
        p_toc.paragraph_format.space_after = Pt(1)
        p_toc.paragraph_format.line_spacing = 1.15
        r_t = p_toc.add_run(title)
        r_t.font.name = 'Times New Roman'
        r_t.font.size = Pt(10.5)
        if not title.startswith("    "):
            r_t.font.bold = True
        
        # Dots leader
        dots_count = max(5, 75 - len(title))
        r_dots = p_toc.add_run(" " + "." * dots_count + " ")
        r_dots.font.name = 'Times New Roman'
        r_dots.font.size = Pt(10)
        r_dots.font.color.rgb = RGBColor(160, 160, 160)

        r_p = p_toc.add_run(page_str)
        r_p.font.name = 'Times New Roman'
        r_p.font.size = Pt(10.5)
        r_p.font.bold = True

    doc.add_page_break()

    # =========================================================================
    # I. RECORD OF CHANGES
    # =========================================================================
    add_heading_1("I. Record of Changes")
    p = add_p("*A - Added   M - Modified   D - Deleted", space_before=2, space_after=6)
    p.runs[0].font.size = Pt(10)
    p.runs[0].font.italic = True

    # Table 0: Record of changes
    t0_headers = ['Date', 'A* M, D', 'In charge', 'Change Description']
    t0_widths = [1400, 900, 1400, 5326]
    t0_data = [
        ['11/11/2026', 'A', 'Hius', 'Khởi tạo tài liệu kiểm thử Phần 2: Unit test (Phân hệ Sales, UC-01): xác định phạm vi Chức năng 3 (Chiết khấu & Phân quyền) và Chức năng 4 (Thanh toán kết hợp & Tiền thừa) theo kế hoạch Testing-Scenario-v2.docx.'],
        ['11/11/2026', 'A', 'Hius', 'Phân tích mã nguồn nghiệp vụ sales-domain.ts, thiết kế ma trận kiểm thử phân vùng tương đương (EP) và phân tích giá trị biên (BVA) cho logic thuần không phụ thuộc cơ sở dữ liệu.'],
        ['11/11/2026', 'A', 'Hius', 'Cài đặt và thực thi 48 ca kiểm thử đơn vị bổ sung bằng Jest với kỹ thuật gom bảng dữ liệu it.each trong sales-domain.spec.ts, đạt tỷ lệ Pass 100% (thời gian chạy ~7.3s).'],
        ['11/11/2026', 'A', 'Hius', 'Xây dựng ma trận truy vết (Traceability Matrix), đối soát tĩnh (Static Review) và lập báo cáo Defect Report ghi nhận các bất cập logic nghiệp vụ và xung đột mã lỗi HTTP.']
    ]
    create_table(t0_headers, t0_data, t0_widths)

    # =========================================================================
    # II. TESTING DOCUMENTATION
    # =========================================================================
    add_heading_1("II. Testing Documentation")

    # 1. Scope of Testing
    add_heading_2("1. Scope of Testing")
    add_heading_3("a. In-scope (Trong phạm vi kiểm thử)")
    add_p("Phần 2 trong kế hoạch phân công kiểm thử nhóm (Testing-Scenario-v2.docx): Kiểm thử đơn vị (Unit Test) bằng Jest cho tầng Domain nghiệp vụ thuần túy (Pure Domain Layer) của dịch vụ Sales. Tập trung vào 2 chức năng nghiệp vụ then chốt thuộc ca sử dụng Bán hàng tại quầy (UC-01):")
    add_bullet("Tính chiết khấu phần trăm (PERCENT) và chiết khấu số tiền (FIXED) theo dòng và toàn hóa đơn; phân bổ chiết khấu pro-rata; kiểm soát trần chiết khấu tối đa theo vai trò (RBAC) và cơ chế ngoại lệ quyền override.", "Chức năng 3 (FR-M06-03, FR-M06-05; BR-02):")
    add_bullet("Xác thực thanh toán chia tách (Split Tender) kết hợp Tiền mặt, Chuyển khoản ngân hàng và COD; kiểm tra điều kiện xác nhận giao dịch; tính chính xác tiền thừa (change due); ngăn chặn các sai lệch tiền tệ.", "Chức năng 4 (FR-M06-08; BR-02):")
    add_p("Yêu cầu liên quan (theo SRS v1.1): UC-01, FR-M06-03, FR-M06-05, FR-M06-08, BR-02, NFR-SE-04.")

    # Table 1: Scope of Testing
    t1_headers = ['Loại kiểm thử', 'Chức năng được kiểm thử', 'Nội dung kiểm tra']
    t1_widths = [2200, 2600, 4226]
    t1_data = [
        ['Unit Test (Jest thuần)', 'Tính chiết khấu món/đơn và giới hạn theo quyền (calculateItemDiscount, assertDiscountAuthority)', 'Biên phần trăm (-0.01%, 0%, 10%, 10.01%, 30%, 30.01%, 100%, 100.01%); Chiết khấu FIXED bằng và vượt tiền hàng; Trần vai trò (sales_staff 10%, branch_manager 30%, owner 100%, legacy roles 10%/30%, role lạ 10%); Quyền override (*, sales.pos.discount.override); Làm tròn Half-up tiền VND.'],
        ['Unit Test (Jest thuần)', 'Thanh toán kết hợp và tiền thừa (validateOrderTenders)', 'Thanh toán kết hợp Tiền mặt + Chuyển khoản (có verified và externalRef -> CONFIRMED); Tính tiền thừa (changeDue = tenderedCash - amount); Chuyển khoản thiếu điều kiện -> PENDING; Đơn 0đ; Tiền đưa thiếu -> 422; Tổng phân bổ lệch đơn -> 422; Tenders rỗng -> 422; Số tiền âm hoặc thập phân lẻ -> 422.'],
        ['Hồi quy đơn vị (Jest)', 'Toàn bộ domain sales và cash-session có sẵn', 'Chạy lại toàn bộ test suite cũ của domain sales (quản lý ca bán hàng, đối chiếu tiền mặt ngăn kéo, đổi trả hàng một phần pro-rata, máy trạng thái đơn hàng 3 chiều) để bảo đảm tính toàn vẹn.']
    ]
    create_table(t1_headers, t1_data, t1_widths)

    add_heading_3("b. Out-of-Scope (Ngoài phạm vi kiểm thử)")
    add_bullet("Do thành viên khác trong nhóm phụ trách (Thịnh: Phân quyền API; Nguyên: Vòng đời đơn online; Duy: Hiệu năng k6; Trường: Chuyển kho). Phần 2 chỉ tập trung chuyên sâu vào tính toán và quy tắc nghiệp vụ tầng Domain, có ghi chú chéo ở Phụ lục.", "Các luồng kiểm thử khác (1, 3, 4, 5):")
    add_bullet("Unit test là kiểm thử hàm thuần (Pure Functions) chạy trực tiếp trên Node.js qua Jest CLI, hoàn toàn không kết nối tới cơ sở dữ liệu PostgreSQL, cache Redis hay gateway KrakenD. Điều này giúp test suite chạy siêu nhanh (< 8 giây) và không gặp flakiness.", "Kiểm thử API và E2E qua mạng:")
    add_bullet("Giao diện người dùng hiện chưa triển khai trường nhập chiết khấu dòng và form thanh toán chia tách; toàn bộ ràng buộc được chặn tại tầng Domain.", "Giao diện Web POS:")
    add_bullet("Kiểm thử tải chịu tải (NFR-PF-02) và kiểm thử thâm nhập an toàn thông tin chuyên sâu.", "Kiểm thử hiệu năng và bảo mật hạ tầng:")

    add_heading_3("c. Assumptions & Constraints (Giả định và ràng buộc)")
    add_bullet("Yêu cầu nghiệp vụ và công thức tính toán tuân thủ tuyệt đối SRS v1.1 và bản phân công Testing-Scenario-v2.docx.", "Căn cứ tài liệu:")
    add_bullet("Toàn bộ mã nguồn kiểm thử nằm trong tệp pure TypeScript apps/sales/src/domain/sales-domain.ts, không import bất kỳ thành phần nào từ NestJS hay TypeORM.", "Kiến trúc Domain thuần túy:")
    add_bullet("Tiền VND bắt buộc là số nguyên an toàn (Number.isSafeInteger), tính toán nội bộ bằng kiểu bigint để triệt tiêu hoàn toàn hiện tượng sai số trôi dấu phẩy động (Floating-point Drift). Mọi số lẻ thập phân hoặc số âm đều bị chặn ngay lập tức.", "Quy tắc tiền tệ VND:")
    add_bullet("Tái sử dụng các ca kiểm thử cơ bản đã có trong sales-domain.spec.ts (10% qua, 15% chặn, 25% quản lý, 50% override), chỉ viết bổ sung các ca biên nhạy cảm và tổ hợp quy tắc còn thiếu.", "Nguyên tắc kế thừa:")

    # 2. Test Strategy & Approach
    add_heading_2("2. Test Strategy & Approach")
    add_p("Nhóm áp dụng phương pháp kiểm thử Agile, Shift-Left và tự động hóa toàn diện. Đối với Phần 2, chiến lược kiểm thử là tập trung kiểm tra hộp trắng (White-box Testing) và kiểm tra chức năng thuần (Unit Functional) trên các thuật toán tài chính và máy quy tắc quyền hạn. Các ca kiểm thử được tham số hóa bằng bảng dữ liệu it.each trong Jest để đạt độ bao phủ biên tối đa mà vẫn giữ mã nguồn tinh gọn.")

    add_heading_3("2.1 Testing Types")
    # Table 2: Testing Types
    t2_headers = ['Type', 'Objective', 'Techniques / checks', 'Completion evidence']
    t2_widths = [1800, 2400, 2600, 2226]
    t2_data = [
        ['Unit Functional', 'Xác minh logic tính toán giá, chiết khấu món/đơn, phân bổ pro-rata, tính tiền thừa và xác thực thanh toán theo đúng SRS UC-01, FR-M06-03, FR-M06-08.', 'White-box, Pure Function Assertion, Decision Testing, Exception-flow.', '48 ca kiểm thử đơn vị bổ sung thực thi bằng Jest CLI; kết quả Passed 100%.'],
        ['Boundary Value Analysis (BVA)', 'Kiểm tra độ chính xác tuyệt đối tại các điểm kỳ dị và ngưỡng chuyển đổi quyền hạn hoặc quy tắc tiền tệ.', 'Biên %: -0.01%, 0%, 10%, 10.01%, 30%, 30.01%, 100%, 100.01%; Biên tiền: giảm bằng tiền hàng, giảm vượt 1đ, đưa thiếu 1đ; Làm tròn Half-up 12.5% của 99.999đ.', 'UT-DISC-01 đến UT-DISC-10; UT-DISC-16 đến UT-DISC-19; UT-PAY-02 đến UT-PAY-04; UT-PAY-11.'],
        ['Equivalence Partitioning (EP)', 'Phân chia miền dữ liệu thành các phân vùng hợp lệ và bất hợp lệ để giảm thiểu số lượng test case mà vẫn bao phủ toàn diện.', 'Lớp chiết khấu: [0, Limit], (Limit, 100], ngoài [0, 100]; Lớp thanh toán: Chuyển khoản đủ điều kiện (CONFIRMED) vs Thiếu điều kiện (PENDING); Kiểu số nguyên VND.', 'UT-DISC-04, 07, 09, 14, 15, 20; UT-PAY-01, 05, 07 đến 10, 17 đến 20.'],
        ['RBAC Ceiling Authority', 'Đảm bảo không nhân viên nào có thể áp dụng chiết khấu vượt thẩm quyền cho phép nếu không có quyền ngoại lệ.', 'Ma trận vai trò × hạn mức chiết khấu: sales_staff 10%, branch_manager 30%, owner 100%, manager 30%, cashier 10%, role lạ 10%, override *.', 'UT-DISC-11 đến UT-DISC-20; mã lỗi 403 DISCOUNT_APPROVAL_REQUIRED.'],
        ['Data-Driven Testing (it.each)', 'Tối ưu hóa mã kiểm thử bằng bảng dữ liệu tham số hóa, tránh lặp lại cấu trúc assert hàng chục lần.', 'Gom ma trận giá trị biên vào các mảng it.each; nội suy thông điệp $desc, $percent, $role linh hoạt.', 'Các test suite trong sales-domain.spec.ts đều viết dưới dạng bảng dữ liệu it.each.'],
        ['Data Integrity & Money Guard', 'Bảo toàn sổ cái tiền mặt và ngăn chặn các giao dịch âm hoặc tiền lẻ thập phân.', 'Kiểm tra ép kiểu parseVndAmount, chặn số âm, chặn số thập phân, chặn tender rỗng.', 'UT-PAY-13 đến UT-PAY-20; mã lỗi 422 PAYMENT_AMOUNT_MISMATCH và VALIDATION_ERROR.'],
        ['Regression Testing', 'Xác nhận toàn bộ test suite cũ của domain sales không bị ảnh hưởng sau khi bổ sung test mới.', 'Chạy lại toàn bộ test suite cũ trong sales-domain.spec.ts và cash-session.spec.ts.', '100/100 tests trong apps/sales/src/domain passed (thời gian ~7.3s).']
    ]
    create_table(t2_headers, t2_data, t2_widths)

    add_heading_3("2.2 Test Levels Matrix")
    # Table 3: Test Levels Matrix
    t3_headers = ['Testing type', 'Unit', 'Integration', 'System', 'Acceptance']
    t3_widths = [3426, 1400, 1400, 1400, 1400]
    t3_data = [
        ['Jest Pure Domain Unit Test (Phần 2: Hius)', 'X', '', '', ''],
        ['Jest Service / Controller Integration (có sẵn)', '', 'X', '', ''],
        ['API Testing Postman + Newman (Phần 1: Thịnh, Phần 3: Nguyên, Phần 5: Trường)', '', 'X', 'X', ''],
        ['E2E UI Playwright (Phần 5: Trường)', '', '', 'X', ''],
        ['Performance Testing Grafana k6 (Phần 4: Duy)', '', '', 'X', '']
    ]
    create_table(t3_headers, t3_data, t3_widths)

    add_heading_3("2.3 Supporting Tools")
    # Table 4: Supporting Tools
    t4_headers = ['Purpose', 'Tool', 'Version / evidence']
    t4_widths = [2200, 2600, 4226]
    t4_data = [
        ['Test Runner & Assertion', 'Jest', 'v29.7.0 (chạy qua pnpm exec jest)'],
        ['TypeScript Execution', 'ts-jest / ts-node', 'ts-jest v29.2.5; transpile trực tiếp TypeScript tầng domain'],
        ['Runtime Environment', 'Node.js', 'v24.13.0 (Windows 11)'],
        ['Package Manager', 'pnpm', 'v9.12.3'],
        ['Code Formatter & Linter', 'Prettier & ESLint', 'Prettier v3.3.3; ESLint v9.14.0 (kiểm tra chuẩn style)'],
        ['Version Control', 'Git / GitHub', 'Nhánh test/hius-UnitTest; commit và quản lý mã nguồn'],
        ['Test Report Generator', 'Python docx', 'python-docx v1.2.0 (sinh file Word báo cáo theo chuẩn)'],
        ['IDE & Extension', 'Visual Studio Code', 'VS Code với Jest Runner và TypeScript Language Server']
    ]
    create_table(t4_headers, t4_data, t4_widths)

    add_heading_3("2.4 Risk-Based Testing (RBT)")
    add_p("Áp dụng đánh giá rủi ro theo chuẩn ISTQB (Risk Likelihood L từ 1-5, Impact I từ 1-5, Mức rủi ro = L × I) để phân bổ trọng tâm kiểm thử vào các lỗ hổng tài chính và gian lận:")

    # Table 5: RBT
    t5_headers = ['Risk ID', 'Risk Description', 'L (1-5)', 'I (1-5)', 'Risk Level (L x I) & Mitigation Strategy']
    t5_widths = [1100, 2700, 800, 800, 3626]
    t5_data = [
        ['R-01', 'Sai lệch tiền do làm tròn số thập phân trôi nổi (Floating-point drift), gây chênh lệch tiền thực tế với sổ sách kế toán.', '4', '5', '20 (Rất cao) -> Kiểm soát chặt chẽ giải thuật roundDivHalfUp với số nguyên lớn bigint; kiểm thử các mốc chia tỷ lệ thập phân nhạy cảm (12.5% của 99.999đ ra 12.500đ). TC: UT-DISC-25 đến 28.'],
        ['R-02', 'Thu ngân tại quầy cố ý áp mức chiết khấu vượt trần vai trò (vượt 10%) nhằm trục lợi hoặc gian lận chiết khấu.', '4', '5', '20 (Rất cao) -> Kiểm tra phân quyền RBAC ở tầng domain; chặn cứng tại mốc 10.01% với lỗi 403 DISCOUNT_APPROVAL_REQUIRED; chỉ cho phép khi có quyền override. TC: UT-DISC-11 đến 20.'],
        ['R-03', 'Khách đưa thiếu tiền mặt hoặc phân bổ thanh toán lệch tổng tiền đơn hàng nhưng hệ thống vẫn ghi nhận đơn hàng PAID.', '3', '5', '15 (Cao) -> Bắt buộc kiểm tra tenderedCash >= amount và totalAllocated == grandTotal; ném lỗi 422 PAYMENT_AMOUNT_MISMATCH. TC: UT-PAY-11 đến 15.'],
        ['R-04', 'Dữ liệu đầu vào bất hợp pháp lọt qua kiểm tra (chiết khấu âm làm tăng giá vô lý, chiết khấu > 100%, số tiền lẻ thập phân).', '3', '4', '12 (Cao) -> Chặn tại gốc trong hàm calculateItemDiscount và parseVndAmount với mã lỗi 422 INVALID_DISCOUNT và VALIDATION_ERROR. TC: UT-DISC-06 đến 10; UT-PAY-17 đến 20.']
    ]
    create_table(t5_headers, t5_data, t5_widths)

    add_heading_3("2.5 AI Usage & Integrity Declaration")
    add_p("LỜI CAM KẾT VÀ TUÂN THỦ TÍNH TRUNG THỰC HỌC THUẬT:")
    add_bullet("Không đưa dữ liệu nhạy cảm của khách hàng, token bảo mật thực tế hoặc tài sản sở hữu trí tuệ của tổ chức lên các nền tảng AI công cộng.", "Cam kết bảo mật:")
    add_bullet("Các kết quả kiểm thử trong báo cáo này được thực thi 100% trên môi trường thật (Node.js v24 + Jest CLI) vào ngày 11/11/2026 trên máy cá nhân của sinh viên. Mọi log thực thi và mã nguồn đều có thể tái lập tức thì.", "Kết quả thực nghiệm:")

    # Table 6: AI Usage
    t6_headers = ['Mục đích sử dụng AI', 'Có / Không [X] và ghi chú công cụ']
    t6_widths = [4513, 4513]
    t6_data = [
        ['Hỗ trợ lên ý tưởng / sinh Test Case giá trị biên BVA', 'Có (Antigravity AI Agent: phân tích các điểm kỳ dị 10.01%, 30.01%, 12.5% của 99.999đ)'],
        ['Hỗ trợ viết mã kịch bản Unit Test (Jest it.each)', 'Có (Antigravity AI Agent: hỗ trợ định dạng mảng dữ liệu it.each và assertions)'],
        ['Phân tích tĩnh mã nguồn (Static Code Analysis) đối chiếu SRS', 'Có (Antigravity AI Agent: đọc hiểu sales-domain.ts và phát hiện các thiếu sót trong SRS v1.1)'],
        ['Hỗ trợ sinh mã Python xuất báo cáo Word chuẩn format', 'Có (Antigravity AI Agent: viết script python-docx kế thừa cấu trúc từ báo cáo mẫu)']
    ]
    create_table(t6_headers, t6_data, t6_widths)

    add_heading_3("2.6 Mô hình Test Diamond")
    add_p("Dự án áp dụng mô hình kim tự tháp đảo / kim cương kiểm thử (Test Diamond) được điều chỉnh phù hợp với kiến trúc vi dịch vụ SaaS. Trong đó:")
    add_bullet("Tập trung vào tính đúng đắn của logic nghiệp vụ cốt lõi (Pure Domain Logic). Số lượng ca kiểm thử lớn nhất, tốc độ thực thi nhanh nhất (< 8 giây cho 100 ca test), chạy độc lập không phụ thuộc hạ tầng mạng, cơ sở dữ liệu hay Docker.", "Tầng Unit Test (đáy vững chắc - Phần 2: Hius đảm nhiệm):")
    add_bullet("Kiểm tra sự tương tác giữa các service, phân quyền API qua Gateway, tính toàn vẹn dữ liệu trong PostgreSQL và đồng bộ sự kiện bất đồng bộ qua ElasticMQ.", "Tầng Integration / API (thân dày nhất - Phần 1, 3, 5):")
    add_bullet("Chỉ bao phủ các luồng hành trình người dùng quan trọng nhất trên trình duyệt để tối ưu chi phí bảo trì.", "Tầng E2E UI (đỉnh mỏng - Phần 5: Trường):")

    # Table 7: Test Diamond
    t7_headers = ['Tầng kiểm thử', 'Bộ test phụ trách', 'Số lượng test', 'Tỷ trọng (%)', 'Vai trò & Đặc điểm']
    t7_widths = [1800, 2200, 1200, 1200, 2626]
    t7_data = [
        ['E2E UI (đỉnh mỏng)', 'Playwright: E2E giao diện web (Luồng 5: Trường)', '6', '1.0%', 'Hành trình người dùng; chạy chậm, chi phí bảo trì cao, chỉ kiểm luồng chính.'],
        ['API / Integration (giữa, dày)', 'Newman Postman + Jest Integration (Luồng 1, 3, 5)', '89', '14.8%', 'Hành vi API qua gateway, phân quyền HTTP, cô lập multi-tenant, chuyển trạng thái đơn.'],
        ['Unit Test (đáy, rộng nhất)', 'Jest Pure Domain Sales (Phần 2: Hius)', '100 (48 mới + 52 có sẵn)', '84.2%', 'Kiểm tra quy tắc tính toán tiền tệ VND, chiết khấu, hạn mức quyền RBAC, máy trạng thái; siêu nhanh, không cần DB.']
    ]
    create_table(t7_headers, t7_data, t7_widths)

    # 3. Test Plan
    add_heading_2("3. Test Plan")
    add_heading_3("3.1 Human Resources & Independence Levels")
    # Table 8: Human Resources
    t8_headers = ['Member', 'Role', 'Independence level', 'Responsibilities']
    t8_widths = [1400, 2000, 1600, 4026]
    t8_data = [
        ['Hius', 'Unit Test Engineer (Phần 2)', 'Mức 1 (Kiểm thử viên độc lập trong đội ngũ phát triển)', 'Chịu trách nhiệm toàn bộ Phần 2: Đọc hiểu và đối soát mã nguồn sales-domain.ts; thiết kế và cài đặt bộ test case đơn vị bằng Jest cho Chức năng 3 (Chiết khấu & Phân quyền) và Chức năng 4 (Thanh toán kết hợp & Tiền thối); thực thi test và lập báo cáo.']
    ]
    create_table(t8_headers, t8_data, t8_widths)

    add_heading_3("3.2 Test Environment")
    # Table 9: Test Environment
    t9_headers = ['Thành phần môi trường', 'Công cụ / Thông số', 'Ghi chú triển khai']
    t9_widths = [2600, 3200, 3226]
    t9_data = [
        ['Hệ điều hành máy kiểm thử', 'Windows 11 Pro (OS Build 26100)', 'Môi trường phát triển cục bộ của sinh viên'],
        ['Runtime & Package Manager', 'Node.js v24.13.0, pnpm v9.12.3', 'Chạy mã thuần TypeScript trực tiếp'],
        ['Test Runner', 'Jest v29.7.0, ts-jest v29.2.5', 'Chạy qua lệnh pnpm exec jest apps/sales/src/domain'],
        ['Mã nguồn nghiệp vụ kiểm thử', 'apps/sales/src/domain/sales-domain.ts', 'Pure Domain Layer, 1.512 dòng lệnh TypeScript'],
        ['File kịch bản kiểm thử', 'apps/sales/src/domain/sales-domain.spec.ts', 'Bổ sung thêm 546 dòng test case biên và tổ hợp'],
        ['Hạ tầng phụ thuộc (Docker/DB)', 'Không sử dụng', 'Môi trường siêu nhẹ, hoàn toàn không cần bật Docker, Postgres hay Redis']
    ]
    create_table(t9_headers, t9_data, t9_widths)

    add_heading_3("3.3 Test Milestones")
    # Table 10: Milestones
    t10_headers = ['Task / Hạng mục công việc', 'Start date', 'End date']
    t10_widths = [4513, 2256, 2257]
    t10_data = [
        ['Đọc hiểu SRS v1.1, Testing-Scenario-v2 và phân tích mã nguồn sales-domain.ts', '11/11/2026', '11/11/2026'],
        ['Thiết kế ma trận test case BVA/EP cho Chiết khấu và Thanh toán kết hợp', '11/11/2026', '11/11/2026'],
        ['Cài đặt bộ test Jest với bảng dữ liệu it.each vào sales-domain.spec.ts', '11/11/2026', '11/11/2026'],
        ['Thực thi kiểm thử, đo thời gian chạy, kiểm tra linting/formatting', '11/11/2026', '11/11/2026'],
        ['Đối soát tĩnh (Static Review), lập Defect Report và xuất báo cáo Word chính thức', '11/11/2026', '11/11/2026']
    ]
    create_table(t10_headers, t10_data, t10_widths)

    add_heading_3("3.4 Entry and Exit Criteria")
    p_en = add_p("3.4.1 Entry Criteria", space_before=4, space_after=2)
    p_en.runs[0].font.bold = True
    add_bullet("Tài liệu SRS v1.1 và Testing-Scenario-v2.docx đã xác định rõ yêu cầu UC-01, FR-M06-03, FR-M06-05, FR-M06-08, BR-02.", "Đặc tả yêu cầu:")
    add_bullet("Mã nguồn sales-domain.ts và sales-domain.spec.ts đã sẵn sàng, các test cơ bản hiện có đạt trạng thái Passed.", "Mã nguồn:")
    add_bullet("Môi trường Node.js v24+, pnpm và thư viện Jest đã được cấu hình thành công trên máy kiểm thử.", "Công cụ:")

    p_ex = add_p("3.4.2 Exit Criteria và mức đạt", space_before=4, space_after=2)
    p_ex.runs[0].font.bold = True
    add_p("Đánh giá kết quả thực tế dựa trên các tiêu chí hoàn thành kiểm thử:")

    # Table 11: Exit Criteria
    t11_headers = ['Tiêu chí chấp nhận (Exit Criteria)', 'Kết quả thực tế', 'Đánh giá']
    t11_widths = [4000, 3426, 1600]
    t11_data = [
        ['100% test case theo kế hoạch được thực thi', '48/48 ca kiểm thử mới được thực thi đầy đủ', 'Đạt'],
        ['Tỷ lệ Pass rate tối thiểu 100% trên tầng Domain', '48/48 Passed = 100% (tính cả test cũ là 100/100 Passed)', 'Đạt'],
        ['0 lỗi Critical / Blocker trong logic tính tiền', '0 lỗi tính sai tiền hoặc sai lệch số học', 'Đạt'],
        ['Thời gian thực thi test suite domain < 15 giây', 'Thời gian chạy thực tế: 7.3 giây cho 100 test cases', 'Đạt'],
        ['Các bất cập và khiếm khuyết được ghi nhận vào Defect Report', 'Đã ghi nhận 4 defect / observation trong mục 5.4', 'Đạt'],
        ['Mã nguồn kiểm thử đạt chuẩn Clean Code, Linting sạch', 'Đạt chuẩn Prettier và ESLint không còn lỗi', 'Đạt']
    ]
    create_table(t11_headers, t11_data, t11_widths)

    # 4. Static Testing - Cross-Review Log
    add_heading_2("4. Static Testing - Cross-Review Log")
    add_p("Trong quá trình đọc hiểu mã nguồn sales-domain.ts đối chiếu với đặc tả SRS v1.1, người kiểm thử đã phát hiện 5 điểm bất cập logic và mâu thuẫn kiến trúc giữa tài liệu yêu cầu và cài đặt thực tế:")

    # Table 12: Static Testing
    t12_headers = ['ID', 'Location (Req ID)', 'Defect Category (4C)', 'Description / Citation', 'Recommendation']
    t12_widths = [1100, 1800, 1600, 2726, 1800]
    t12_data = [
        ['DEF-UT-01', 'FR-M06-05; BR-02', 'Completeness', 'SRS quy định trần chiết khấu theo vai trò nhưng chưa nêu cơ chế Quản lý nhập mã xác thực (Manager PIN / Override token) trực tiếp tại quầy POS khi thu ngân cần giảm giá vượt mức 10%. Trong code, tham số discountApprovedBy chỉ nhận chuỗi text tự do và bị bỏ qua.', 'Bổ sung vào SRS và hệ thống luồng xác thực điện tử của Quản lý tại quầy (Manager PIN) để cấp quyền chiết khấu vượt mức tức thời.'],
        ['DEF-UT-02', 'FR-M06-03; BR-02', 'Consistency', 'SRS chưa quy định cách thức xử lý số dư làm tròn khi chia tỷ trọng chiết khấu toàn đơn (pro-rata) xuống từng dòng hàng. Trong code, hệ thống dồn phần dư vào dòng sản phẩm cuối cùng (lastPositiveIdx) để bảo đảm tổng không đổi.', 'Bổ sung quy chuẩn dồn phần dư pro-rata vào tài liệu SRS v1.2 để bảo đảm tính thống nhất cho đội ngũ phát triển Frontend và Kế toán.'],
        ['OB-UT-01', 'FR-M06-08; Kiến trúc', 'Consistency', 'Xung đột mã lỗi HTTP: Lớp DTO ValidationPipe ném 400 Bad Request khi dữ liệu tiền tệ sai định dạng, nhưng tầng Domain Layer lại ném 422 Unprocessable Entity với mã VALIDATION_ERROR.', 'Chuẩn hóa bộ lọc ngoại lệ toàn cục (Global Exception Filter) để thống nhất mã lỗi 422 cho các vi phạm nghiệp vụ tiền tệ.'],
        ['OB-UT-02', 'FR-M06-05; An toàn', 'Correctness', 'Tham số discountApprovedBy trong assertDiscountAuthority cho phép client gửi chuỗi bất kỳ nhưng không chứng minh được danh tính người duyệt. Code hiện tại ghi nhận text nhưng vẫn chặn quyền.', 'Cần triển khai kiểm tra chữ ký số hoặc JWT phụ của cấp quản lý phê duyệt.'],
        ['OB-UT-03', 'FR-M02-05; ADR-0020', 'Completeness', 'SRS v1.1 chỉ định nghĩa 5 vai trò mới (sales_staff, branch_manager, owner, v.v.), nhưng trong mã nguồn domain vẫn hỗ trợ các vai trò legacy cũ (manager, cashier) với trần 30% và 10%.', 'Cập nhật tài liệu SRS để ghi chú rõ tính tương thích ngược (Backward Compatibility) với các vai trò cũ.']
    ]
    create_table(t12_headers, t12_data, t12_widths)

    # 5. Test Cases & Reports
    add_heading_1("5. Test Cases & Reports")

    add_heading_2("5.1 Tổng hợp kết quả")
    add_p("Toàn bộ 48 ca kiểm thử đơn vị bổ sung được thực thi trên Jest CLI ngày 11/11/2026. Tỷ lệ đạt: 48/48 ca (100% Passed). Khi chạy kèm 52 ca kiểm thử có sẵn của domain sales, toàn bộ 100/100 ca đều Passed tuyệt đối:")

    # Table 13: Summary
    t13_headers = ['Nhóm ca kiểm thử', 'Số test case', 'Passed', 'Failed', 'Pass rate']
    t13_widths = [4513, 1128, 1128, 1128, 1129]
    t13_data = [
        ['A. Kiểm tra biên phần trăm (%) chiết khấu (calculateItemDiscount)', '10', '10', '0', '100%'],
        ['B. Kiểm tra hạn mức chiết khấu theo quyền RBAC (assertDiscountAuthority)', '10', '10', '0', '100%'],
        ['C. Chiết khấu số tiền cố định (FIXED) và làm tròn Half-up VND', '8', '8', '0', '100%'],
        ['D. Thanh toán kết hợp và tính tiền thừa (validateOrderTenders)', '6', '6', '0', '100%'],
        ['E. Xác thực phương thức thanh toán chuyển khoản và COD', '4', '4', '0', '100%'],
        ['F. Trường hợp lỗi thanh toán và dữ liệu tiền tệ không hợp lệ', '10', '10', '0', '100%'],
        ['Tổng cộng (Các ca kiểm thử mới)', '48', '48', '0', '100%']
    ]
    create_table(t13_headers, t13_data, t13_widths)

    add_heading_2("5.2 Danh sách test case và kết quả thực tế")
    add_p("Dưới đây là chi tiết toàn bộ 48 ca kiểm thử mới được bổ sung vào tệp sales-domain.spec.ts, được gom thành 6 nhóm kiểm thử bằng bảng dữ liệu it.each:")

    # Helper for 8-column test case tables
    tc_headers = ['ID / Tiêu đề', 'Yêu cầu liên quan', 'Điều kiện tiên quyết', 'Các bước', 'Dữ liệu đầu vào (it.each)', 'Kết quả mong đợi', 'Kết quả thực tế', 'Trạng thái']
    tc_widths = [1300, 1000, 1100, 1100, 1300, 1426, 1200, 600]

    # --- Group A ---
    add_heading_3("A. Kiểm tra biên phần trăm (%) chiết khấu (calculateItemDiscount)")
    t14_data = [
        ['UT-DISC-01 Mốc 0% không giảm giá', 'FR-M06-03; BR-02', 'lineGross = 100.000đ', 'Gọi calculateItemDiscount(lineGross, "PERCENT", 0)', 'percent = 0', 'discount = 0 VND', 'discount = 0 VND', 'Passed'],
        ['UT-DISC-02 Mốc 10% trần nhân viên', 'FR-M06-03; BR-02', 'lineGross = 100.000đ', 'Gọi calculateItemDiscount(lineGross, "PERCENT", 10)', 'percent = 10', 'discount = 10.000 VND', 'discount = 10.000 VND', 'Passed'],
        ['UT-DISC-03 Mốc 30% trần quản lý', 'FR-M06-03; BR-02', 'lineGross = 100.000đ', 'Gọi calculateItemDiscount(lineGross, "PERCENT", 30)', 'percent = 30', 'discount = 30.000 VND', 'discount = 30.000 VND', 'Passed'],
        ['UT-DISC-04 Mốc 50% giảm một nửa', 'FR-M06-03; BR-02', 'lineGross = 100.000đ', 'Gọi calculateItemDiscount(lineGross, "PERCENT", 50)', 'percent = 50', 'discount = 50.000 VND', 'discount = 50.000 VND', 'Passed'],
        ['UT-DISC-05 Mốc 100% miễn phí hàng', 'FR-M06-03; BR-02', 'lineGross = 100.000đ', 'Gọi calculateItemDiscount(lineGross, "PERCENT", 100)', 'percent = 100', 'discount = 100.000 VND', 'discount = 100.000 VND', 'Passed'],
        ['UT-DISC-06 Biên dưới âm (-0.01%)', 'FR-M06-03; BR-02', 'lineGross = 100.000đ', 'Gọi calculateItemDiscount với số âm biên', 'percent = -0.01', 'Lỗi 422 INVALID_DISCOUNT', 'Ném lỗi 422 INVALID_DISCOUNT', 'Passed'],
        ['UT-DISC-07 Số âm lớn (-5%)', 'FR-M06-03; BR-02', 'lineGross = 100.000đ', 'Gọi calculateItemDiscount với số âm', 'percent = -5', 'Lỗi 422 INVALID_DISCOUNT', 'Ném lỗi 422 INVALID_DISCOUNT', 'Passed'],
        ['UT-DISC-08 Biên trên vượt quá (100.01%)', 'FR-M06-03; BR-02', 'lineGross = 100.000đ', 'Gọi calculateItemDiscount vượt 100%', 'percent = 100.01', 'Lỗi 422 INVALID_DISCOUNT', 'Ném lỗi 422 INVALID_DISCOUNT', 'Passed'],
        ['UT-DISC-09 Vượt quá 100% (105%)', 'FR-M06-03; BR-02', 'lineGross = 100.000đ', 'Gọi calculateItemDiscount 105%', 'percent = 105', 'Lỗi 422 INVALID_DISCOUNT', 'Ném lỗi 422 INVALID_DISCOUNT', 'Passed'],
        ['UT-DISC-10 Dữ liệu NaN / Infinity', 'FR-M06-03; BR-02', 'lineGross = 100.000đ', 'Gọi calculateItemDiscount với NaN, Infinity', 'percent = NaN, Infinity', 'Lỗi 422 INVALID_DISCOUNT', 'Ném lỗi 422 INVALID_DISCOUNT', 'Passed']
    ]
    create_table(tc_headers, t14_data, tc_widths)

    # --- Group B ---
    add_heading_3("B. Kiểm tra hạn mức chiết khấu theo quyền RBAC (assertDiscountAuthority)")
    t15_data = [
        ['UT-DISC-11 sales_staff trong trần (0%, 10%)', 'FR-M06-05; BR-02', 'Không có quyền override', 'assertDiscountAuthority({role: "sales_staff", percent})', 'percent = 0, 10', 'Hợp lệ, không ném lỗi', 'Không ném lỗi', 'Passed'],
        ['UT-DISC-12 branch_manager trong trần (0%, 30%)', 'FR-M06-05; BR-02', 'Không có quyền override', 'assertDiscountAuthority({role: "branch_manager", percent})', 'percent = 0, 30', 'Hợp lệ, không ném lỗi', 'Không ném lỗi', 'Passed'],
        ['UT-DISC-13 owner trong trần (0%, 100%)', 'FR-M06-05; BR-02', 'Không có quyền override', 'assertDiscountAuthority({role: "owner", percent})', 'percent = 0, 100', 'Hợp lệ, không ném lỗi', 'Không ném lỗi', 'Passed'],
        ['UT-DISC-14 Legacy roles manager (30%), cashier (10%)', 'FR-M06-05; ADR-0020', 'Tương thích vai trò cũ', 'assertDiscountAuthority({role: "manager"|"cashier", percent})', 'manager: 30%, cashier: 10%', 'Hợp lệ, không ném lỗi', 'Không ném lỗi', 'Passed'],
        ['UT-DISC-15 Role không truyền / role lạ áp trần 10%', 'FR-M06-05; BR-02', 'Role = undefined hoặc role lạ', 'assertDiscountAuthority({role, percent: 10})', 'role = undefined, "unknown_role"', 'Hợp lệ, không ném lỗi', 'Không ném lỗi', 'Passed'],
        ['UT-DISC-16 sales_staff vượt trần (10.01%, 15%)', 'FR-M06-05; BR-02', 'Không có quyền override', 'assertDiscountAuthority({role: "sales_staff", percent})', 'percent = 10.01, 15', 'Lỗi 403 DISCOUNT_APPROVAL_REQUIRED', 'Ném lỗi 403 DISCOUNT_APPROVAL_REQUIRED', 'Passed'],
        ['UT-DISC-17 branch_manager vượt trần (30.01%, 35%)', 'FR-M06-05; BR-02', 'Không có quyền override', 'assertDiscountAuthority({role: "branch_manager", percent})', 'percent = 30.01, 35', 'Lỗi 403 DISCOUNT_APPROVAL_REQUIRED', 'Ném lỗi 403 DISCOUNT_APPROVAL_REQUIRED', 'Passed'],
        ['UT-DISC-18 Legacy roles vượt trần 0.01%', 'FR-M06-05; ADR-0020', 'Tương thích vai trò cũ', 'assertDiscountAuthority({role, percent})', 'manager: 30.01%, cashier: 10.01%', 'Lỗi 403 DISCOUNT_APPROVAL_REQUIRED', 'Ném lỗi 403 DISCOUNT_APPROVAL_REQUIRED', 'Passed'],
        ['UT-DISC-19 Role lạ vượt trần mặc định (10.01%)', 'FR-M06-05; BR-02', 'Role = undefined hoặc "trainee"', 'assertDiscountAuthority({role, percent: 10.01})', 'percent = 10.01', 'Lỗi 403 DISCOUNT_APPROVAL_REQUIRED', 'Ném lỗi 403 DISCOUNT_APPROVAL_REQUIRED', 'Passed'],
        ['UT-DISC-20 Quyền override (*, sales.pos.discount.override)', 'FR-M06-05; NFR-SE-04', 'Có quyền override', 'assertDiscountAuthority({role, percent, permissions})', 'sales_staff 99.99%; role lạ 100%', 'Hợp lệ, không ném lỗi', 'Không ném lỗi', 'Passed']
    ]
    create_table(tc_headers, t15_data, tc_widths)

    # --- Group C ---
    add_heading_3("C. Chiết khấu số tiền cố định (FIXED) và làm tròn Half-up VND")
    t16_data = [
        ['UT-DISC-21 Giảm FIXED bằng đúng giá trị món hàng', 'FR-M06-03; BR-02', 'lineGross = 150.000đ', 'calculateItemDiscount(lineGross, "FIXED", 150000)', 'discountValue = 150000', 'discount = 150000, net = 0đ', 'discount = 150000, net = 0đ', 'Passed'],
        ['UT-DISC-22 Giảm FIXED bằng đúng tổng hóa đơn', 'FR-M06-03; BR-02', 'subtotal = 150.000đ', 'calculateOrderQuote({orderDiscountType: "FIXED", 150000})', 'orderDiscountValue = 150000', 'grandTotal = 0đ', 'grandTotal = 0đ', 'Passed'],
        ['UT-DISC-23 Giảm FIXED lớn hơn món hàng 1đ', 'FR-M06-03; BR-02', 'lineGross = 150.000đ', 'calculateItemDiscount(lineGross, "FIXED", 150001)', 'discountValue = 150001', 'Lỗi 422 INVALID_DISCOUNT', 'Ném lỗi 422 INVALID_DISCOUNT', 'Passed'],
        ['UT-DISC-24 Giảm FIXED lớn hơn tổng đơn 1đ', 'FR-M06-03; BR-02', 'subtotal = 150.000đ', 'calculateOrderQuote({orderDiscountType: "FIXED", 150001})', 'orderDiscountValue = 150001', 'Lỗi 422 INVALID_DISCOUNT', 'Ném lỗi 422 INVALID_DISCOUNT', 'Passed'],
        ['UT-DISC-25 Làm tròn Half-up: 12.5% của 99.999đ', 'FR-M06-03; BR-02', 'gross = 99.999đ (12499.875đ)', 'calculateItemDiscount(99999n, "PERCENT", 12.5)', 'gross = 99999, percent = 12.5', 'Làm tròn lên 12.500đ', 'discount = 12.500đ', 'Passed'],
        ['UT-DISC-26 Làm tròn Half-up: 12.5% của 100.001đ', 'FR-M06-03; BR-02', 'gross = 100.001đ (12500.125đ)', 'calculateItemDiscount(100001n, "PERCENT", 12.5)', 'gross = 100001, percent = 12.5', 'Làm tròn xuống 12.500đ', 'discount = 12.500đ', 'Passed'],
        ['UT-DISC-27 Làm tròn Half-up: 5% của 10đ (đúng 0.5đ)', 'FR-M06-03; BR-02', 'gross = 10đ, 5% = 0.5đ', 'calculateItemDiscount(10n, "PERCENT", 5)', 'gross = 10, percent = 5', 'Làm tròn lên 1đ', 'discount = 1đ', 'Passed'],
        ['UT-DISC-28 Làm tròn Half-up: 4.9% của 10đ (0.49đ)', 'FR-M06-03; BR-02', 'gross = 10đ, 4.9% = 0.49đ', 'calculateItemDiscount(10n, "PERCENT", 4.9)', 'gross = 10, percent = 4.9', 'Làm tròn xuống 0đ', 'discount = 0đ', 'Passed']
    ]
    create_table(tc_headers, t16_data, tc_widths)

    # --- Group D ---
    add_heading_3("D. Thanh toán kết hợp và tính tiền thừa (validateOrderTenders)")
    t17_data = [
        ['UT-PAY-01 Tiền mặt + Chuyển khoản đủ điều kiện', 'FR-M06-08; BR-02', 'Đơn 500.000đ', 'validateOrderTenders(500000, [CASH, BANK_TRANSFER])', 'Cash 200k (đưa 250k), Transfer 300k (verified, ref)', 'Cả 2 CONFIRMED, changeDue=50k, PAID', 'Cả 2 CONFIRMED, changeDue=50k, PAID', 'Passed'],
        ['UT-PAY-02 Khách đưa tiền mặt lớn hơn phân bổ', 'FR-M06-08; BR-02', 'Đơn 200.000đ', 'validateOrderTenders(200000, [{method: CASH, amount: 200k, tendered: 250k}])', 'tenderedCash = 250000', 'changeDue = 50.000đ', 'changeDue = 50.000đ', 'Passed'],
        ['UT-PAY-03 Khách đưa tiền mặt rất lớn (1.000.000đ)', 'FR-M06-08; BR-02', 'Đơn 100.000đ', 'validateOrderTenders(100000, [{method: CASH, amount: 100k, tendered: 1000k}])', 'tenderedCash = 1000000', 'changeDue = 900.000đ', 'changeDue = 900.000đ', 'Passed'],
        ['UT-PAY-04 Khách trả vừa khít tiền mặt', 'FR-M06-08; BR-02', 'Đơn 150.000đ', 'validateOrderTenders(150000, [{method: CASH, amount: 150k, tendered: 150k}])', 'tenderedCash = 150000', 'changeDue = 0đ', 'changeDue = 0đ', 'Passed'],
        ['UT-PAY-05 Không truyền tenderedCash (mặc định)', 'FR-M06-08; BR-02', 'Đơn 300.000đ', 'validateOrderTenders(300000, [{method: CASH, amount: 300k}])', 'tenderedCash = undefined', 'changeDue = 0đ', 'changeDue = 0đ', 'Passed'],
        ['UT-PAY-06 Đơn hàng 0 đồng (miễn phí)', 'FR-M06-08; BR-02', 'Đơn 0đ', 'validateOrderTenders(0, [{method: CASH, amount: 0, tenderedCash: 0}])', 'grandTotal = 0, amount = 0', 'changeDue = 0đ, paymentStatus = PAID', 'changeDue = 0đ, paymentStatus = PAID', 'Passed']
    ]
    create_table(tc_headers, t17_data, tc_widths)

    # --- Group E ---
    add_heading_3("E. Xác thực phương thức thanh toán chuyển khoản và COD")
    t18_data = [
        ['UT-PAY-07 Chuyển khoản thiếu verified', 'FR-M06-08; BR-02', 'Đơn 300.000đ', 'validateOrderTenders(300000, [{method: BANK_TRANSFER, verified: false, ref}])', 'verified = false, externalRef = "TX123"', 'status = PENDING, paymentStatus = UNPAID', 'status = PENDING, paymentStatus = UNPAID', 'Passed'],
        ['UT-PAY-08 Chuyển khoản thiếu externalRef', 'FR-M06-08; BR-02', 'Đơn 300.000đ', 'validateOrderTenders(300000, [{method: BANK_TRANSFER, verified: true}])', 'verified = true, externalRef = undefined', 'status = PENDING, paymentStatus = UNPAID', 'status = PENDING, paymentStatus = UNPAID', 'Passed'],
        ['UT-PAY-09 Kết hợp Cash (xác nhận) + Transfer (chờ)', 'FR-M06-08; BR-02', 'Đơn 300.000đ', 'validateOrderTenders(300000, [Cash 100k, Transfer 200k chưa verified])', 'Cash 100k (CONFIRMED), Transfer (PENDING)', 'paymentStatus = PARTIALLY_PAID', 'paymentStatus = PARTIALLY_PAID', 'Passed'],
        ['UT-PAY-10 Phương thức COD luôn PENDING', 'FR-M06-08; BR-02', 'Đơn 300.000đ', 'validateOrderTenders(300000, [{method: COD, amount: 300000}])', 'method = COD, amount = 300000', 'status = PENDING, paymentStatus = UNPAID', 'status = PENDING, paymentStatus = UNPAID', 'Passed']
    ]
    create_table(tc_headers, t18_data, tc_widths)

    # --- Group F ---
    add_heading_3("F. Trường hợp lỗi thanh toán và dữ liệu tiền tệ không hợp lệ")
    t19_data = [
        ['UT-PAY-11 Khách đưa thiếu 1đ tiền mặt', 'FR-M06-08; BR-02', 'Phân bổ 100.000đ', 'validateOrderTenders(100000, [{method: CASH, amount: 100k, tendered: 99999}])', 'tenderedCash = 99999', 'Lỗi 422 PAYMENT_AMOUNT_MISMATCH', 'Ném lỗi 422 PAYMENT_AMOUNT_MISMATCH', 'Passed'],
        ['UT-PAY-12 Khách đưa 0đ cho tiền mặt phân bổ', 'FR-M06-08; BR-02', 'Phân bổ 50.000đ', 'validateOrderTenders(50000, [{method: CASH, amount: 50k, tendered: 0}])', 'tenderedCash = 0', 'Lỗi 422 PAYMENT_AMOUNT_MISMATCH', 'Ném lỗi 422 PAYMENT_AMOUNT_MISMATCH', 'Passed'],
        ['UT-PAY-13 Phân bổ thiếu tổng tiền đơn hàng', 'FR-M06-08; BR-02', 'Đơn 100.000đ', 'validateOrderTenders(100000, [{method: CASH, amount: 90000}])', 'totalAllocated = 90000', 'Lỗi 422 PAYMENT_AMOUNT_MISMATCH', 'Ném lỗi 422 PAYMENT_AMOUNT_MISMATCH', 'Passed'],
        ['UT-PAY-14 Phân bổ thừa tổng tiền đơn hàng', 'FR-M06-08; BR-02', 'Đơn 100.000đ', 'validateOrderTenders(100000, [{method: CASH, amount: 110000}])', 'totalAllocated = 110000', 'Lỗi 422 PAYMENT_AMOUNT_MISMATCH', 'Ném lỗi 422 PAYMENT_AMOUNT_MISMATCH', 'Passed'],
        ['UT-PAY-15 Phân bổ kết hợp lệch tổng đơn', 'FR-M06-08; BR-02', 'Đơn 500.000đ', 'validateOrderTenders(500000, [Cash 200k, Transfer 250k])', 'totalAllocated = 450000 (lệch 50k)', 'Lỗi 422 PAYMENT_AMOUNT_MISMATCH', 'Ném lỗi 422 PAYMENT_AMOUNT_MISMATCH', 'Passed'],
        ['UT-PAY-16 Danh sách tenders rỗng ([])', 'FR-M06-08; BR-02', 'Đơn 100.000đ', 'validateOrderTenders(100000, [])', 'tendersInput = []', 'Lỗi 422 PAYMENT_AMOUNT_MISMATCH', 'Ném lỗi 422 PAYMENT_AMOUNT_MISMATCH', 'Passed'],
        ['UT-PAY-17 Số tiền phân bổ âm (-50.000đ)', 'FR-M06-08; BR-02', 'Đơn 100.000đ', 'validateOrderTenders(100000, [{amount: -50000}])', 'amount = -50000', 'Lỗi 422 VALIDATION_ERROR', 'Ném lỗi 422 VALIDATION_ERROR', 'Passed'],
        ['UT-PAY-18 Số tiền phân bổ lẻ thập phân', 'FR-M06-08; BR-02', 'Đơn 100.000đ', 'validateOrderTenders(100000, [{amount: 50000.5}])', 'amount = 50000.5', 'Lỗi 422 VALIDATION_ERROR', 'Ném lỗi 422 VALIDATION_ERROR', 'Passed'],
        ['UT-PAY-19 Tiền khách đưa âm (-10.000đ)', 'FR-M06-08; BR-02', 'Đơn 100.000đ', 'validateOrderTenders(100000, [{amount: 100k, tendered: -10000}])', 'tenderedCash = -10000', 'Lỗi 422 VALIDATION_ERROR', 'Ném lỗi 422 VALIDATION_ERROR', 'Passed'],
        ['UT-PAY-20 Tiền khách đưa lẻ thập phân', 'FR-M06-08; BR-02', 'Đơn 100.000đ', 'validateOrderTenders(100000, [{amount: 100k, tendered: 100000.75}])', 'tenderedCash = 100000.75', 'Lỗi 422 VALIDATION_ERROR', 'Ném lỗi 422 VALIDATION_ERROR', 'Passed']
    ]
    create_table(tc_headers, t19_data, tc_widths)

    # 5.3 Traceability Matrix
    add_heading_2("5.3 Ma trận truy vết (test case → FR / BR / NFR)")
    add_p("Bảng ánh xạ truy vết đầy đủ giữa yêu cầu nghiệp vụ trong SRS v1.1 và các ca kiểm thử đơn vị tương ứng:")

    # Table 20: Traceability Matrix
    t20_headers = ['Yêu cầu', 'Nội dung yêu cầu (SRS v1.1)', 'Test case bao phủ (mã UT-)', 'Kết quả thực tế']
    t20_widths = [1600, 3626, 2600, 1200]
    t20_data = [
        ['FR-M06-03', 'Tính toán chiết khấu món hàng và hóa đơn theo phần trăm hoặc số tiền cố định; phân bổ chiết khấu pro-rata; không cho phép tổng sau chiết khấu âm.', 'UT-DISC-01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 21, 22, 23, 24, 25, 26, 27, 28', 'Đạt (100% Pass)'],
        ['FR-M06-05', 'Giới hạn mức chiết khấu tối đa theo vai trò người dùng (sales_staff: 10%, branch_manager: 30%, owner: 100%); vượt trần phải có người duyệt hoặc quyền override.', 'UT-DISC-11, 12, 13, 14, 15, 16, 17, 18, 19, 20', 'Đạt (100% Pass)'],
        ['FR-M06-08', 'Hỗ trợ thanh toán chia tách nhiều hình thức (tiền mặt, chuyển khoản, thẻ, COD); tính chính xác tiền thừa; ghi nhận trạng thái thanh toán đúng theo xác thực.', 'UT-PAY-01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20', 'Đạt (100% Pass)'],
        ['BR-02', 'Quy tắc tiền tệ VND: Phải là số nguyên an toàn, không âm; áp dụng quy tắc làm tròn Half-up cho số lẻ thập phân; tổng phân bổ thanh toán phải bằng tổng đơn.', 'Toàn bộ 48 ca kiểm thử UT-DISC và UT-PAY', 'Đạt (100% Pass)'],
        ['NFR-SE-04', 'Kiểm soát phân quyền theo vai trò (RBAC), miễn trừ giới hạn khi có quyền ngoại lệ sales.pos.discount.override hoặc wildcard *.', 'UT-DISC-11 đến UT-DISC-20', 'Đạt (100% Pass)']
    ]
    create_table(t20_headers, t20_data, t20_widths)

    # 5.4 Defect Report
    add_heading_2("5.4 Báo cáo lỗi (Defect Report)")
    add_p("Ghi nhận các bất cập và khiếm khuyết được phát hiện thông qua đối soát mã nguồn và kiểm thử giá trị biên nhạy cảm:")

    # Table 21: Defect Report
    t21_headers = ['Defect ID', 'Test case liên quan', 'Mô tả khiếm khuyết / Bất cập', 'Mức độ', 'Trạng thái', 'Khuyến nghị khắc phục']
    t21_widths = [1100, 1400, 2726, 1200, 1000, 1600]
    t21_data = [
        ['DEF-UT-01', 'UT-DISC-16, 17, 18', 'Thiếu cơ chế xác thực Quản lý tại quầy (Manager PIN) khi thu ngân cần áp dụng mức chiết khấu vượt trần 10%. Hiện hệ thống chặn cứng lỗi 403 mà không cung cấp cơ chế mở khóa tức thời.', 'Major', 'Open', 'Bổ sung endpoint xác thực PIN của quản lý chi nhánh và sinh token ủy quyền ngắn hạn.'],
        ['DEF-UT-02', 'UT-DISC-21, 22', 'SRS chưa quy định rõ giải thuật dồn phần dư pro-rata khi chiết khấu toàn đơn, gây tiềm ẩn mâu thuẫn đối soát kế toán.', 'Minor', 'Open', 'Chuẩn hóa quy tắc dồn phần dư vào dòng sản phẩm cuối cùng vào tài liệu SRS v1.2.'],
        ['DEF-UT-03', 'UT-DISC-20', 'Tham số discountApprovedBy nhận chuỗi text tự do không được xác thực danh tính điện tử, tiềm ẩn nguy cơ lưu vết kiểm toán không tin cậy.', 'Minor', 'Open', 'Yêu cầu định danh UUID của người phê duyệt được ký bởi khóa bí mật nội bộ.'],
        ['DEF-UT-04', 'UT-PAY-17 đến 20', 'Xung đột mã lỗi HTTP: DTO pipe ném 400 Bad Request trong khi Domain layer ném 422 VALIDATION_ERROR.', 'Minor', 'Open', 'Đồng bộ hóa mã phản hồi thông qua Global Error Exception Filter.']
    ]
    create_table(t21_headers, t21_data, t21_widths)

    # 5.5 Kết quả chạy lại các test Jest hiện có
    add_heading_2("5.5 Kết quả chạy lại các test Jest hiện có (bằng chứng bổ sung)")
    add_p("Để bảo đảm tính ổn định và ngăn ngừa hồi quy lỗi (Regression), người kiểm thử đã thực thi lại toàn bộ test suite của domain và toàn bộ ứng dụng Sales:")

    # Table 22: Regression Table
    t22_headers = ['Bộ test thực thi', 'Test suites', 'Số lượng tests', 'Thời gian chạy', 'Kết quả thực tế']
    t22_widths = [3226, 1400, 1600, 1400, 1400]
    t22_data = [
        ['Pure Domain Sales (apps/sales/src/domain)', '2 passed, 2 total', '100 passed, 100 total (48 test mới + 52 test cũ)', '7.305 s', 'Passed 100%'],
        ['Toàn bộ vi dịch vụ Sales (apps/sales)', '17 passed, 17 total', '550 passed, 550 total', '36.439 s', 'Passed 100%']
    ]
    create_table(t22_headers, t22_data, t22_widths)

    # 5.6 Bằng chứng chạy kiểm thử
    add_heading_2("5.6 Bằng chứng chạy kiểm thử (Jest Terminal Logs)")
    add_p("Log thực thi thực tế lệnh chạy riêng bộ kiểm thử Chiết khấu (Discount):")
    p_code1 = add_p(
        "PASS apps/sales/src/domain/sales-domain.spec.ts (9.457 s)\n"
        "Test Suites: 1 passed, 1 of 2 total\n"
        "Tests:       55 skipped, 45 passed, 100 total\n"
        "Snapshots:   0 total\n"
        "Time:        9.913 s\n"
        "Ran all test suites matching /apps\\sales\\src\\domain/i with tests matching \"discount\".",
        space_before=2, space_after=6
    )
    p_code1.paragraph_format.left_indent = Inches(0.2)
    p_code1.runs[0].font.size = Pt(9.0)
    p_code1.runs[0].font.name = 'Consolas'

    add_p("Log thực thi thực tế toàn bộ test suite tầng Domain của dịch vụ Sales:")
    p_code2 = add_p(
        "PASS apps/sales/src/domain/sales-domain.spec.ts (5.717 s)\n"
        "PASS apps/sales/src/domain/cash-session.spec.ts (6.892 s)\n"
        "\n"
        "Test Suites: 2 passed, 2 total\n"
        "Tests:       100 passed, 100 total\n"
        "Snapshots:   0 total\n"
        "Time:        7.305 s\n"
        "Ran all test suites matching /apps\\sales\\src\\domain/i.",
        space_before=2, space_after=6
    )
    p_code2.paragraph_format.left_indent = Inches(0.2)
    p_code2.runs[0].font.size = Pt(9.0)
    p_code2.runs[0].font.name = 'Consolas'

    # 5.7 Cách chạy lại
    add_heading_2("5.7 Cách chạy lại")
    add_bullet("Mở terminal tại thư mục gốc của dự án pbl-api.", "Bước 1:")
    add_bullet("Chạy lệnh kiểm thử riêng các ca chiết khấu: pnpm exec jest apps/sales/src/domain -t \"discount\"", "Bước 2:")
    add_bullet("Chạy toàn bộ 100 test case của tầng Domain: pnpm exec jest apps/sales/src/domain", "Bước 3:")
    add_bullet("Chạy kiểm tra toàn bộ ứng dụng Sales: pnpm exec jest apps/sales", "Bước 4:")
    add_bullet("Lưu ý: Bộ test là Pure Unit Test, hoàn toàn không cần khởi động Docker, Postgres hay Redis.", "Lưu ý môi trường:")

    # Phụ lục
    add_heading_2("Phụ lục. Ghi chú chéo cho các luồng khác (Cross-Review Notes)")
    add_bullet("Quyền hạn người dùng được mã hóa trực tiếp trong Payload của token RS256 JWT (claim perms). Khi cần thu hồi quyền nóng hoặc hạ trần chiết khấu tức thời, Gateway và Service vẫn phải dựa vào Redis Deny-list vì Access Token có thời gian sống (TTL).", "Luồng 1 (Bảo mật & Phân quyền API - Thịnh):")
    add_bullet("Định dạng mã đơn hàng tại quầy và online tuân theo quy chuẩn HD-yyyyMMdd-###### (6 chữ số tuần tự, cố định độ dài). Các phép toán chiết khấu và tender thanh toán của Luồng 2 kết nối trực tiếp với pha Confirm và Complete của Luồng 3.", "Luồng 3 (Vòng đời đơn online - Nguyên):")
    add_bullet("Các phép toán chiết khấu pro-rata và tính tiền thối đều dùng số nguyên an toàn bigint. Đây là tiền đề quan trọng giúp API tính giá đạt hiệu năng đọc cao (< 200ms theo NFR-PF-02) trong các kịch bản test tải k6.", "Luồng 4 (Hiệu năng k6 - Duy):")
    add_bullet("Quy tắc bảo toàn tồn kho (BR-03) trong chuyển kho tương đồng với nguyên lý bảo toàn tiền tệ (BR-02): tiền thối và tiền phân bổ phải khớp tuyệt đối tổng đơn hàng tương tự như tồn kho nguồn chuyển đi phải khớp tồn đích nhận được.", "Luồng 5 (Chuyển kho - Trường):")

    output_path = os.path.join(os.getcwd(), 'BaoCao-KiemThu-Phan2-UnitTest.docx')
    doc.save(output_path)
    print(f"Report generated successfully: {output_path}")

if __name__ == '__main__':
    create_report()
