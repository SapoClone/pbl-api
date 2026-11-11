"""Create the evidence-led Vietnamese Word report using Python standard library."""
from pathlib import Path
from xml.sax.saxutils import escape
from zipfile import ZipFile, ZIP_DEFLATED

out = Path(__file__).with_name('BaoCao-KiemThu-API-Nguyen-DonOnline-GiuTon.docx')
parts = []

def p(text='', level=0, page=False):
    style = f'<w:pStyle w:val="Heading{level}"/>' if level else ''
    br = '<w:pageBreakBefore/>' if page else ''
    parts.append(f'<w:p><w:pPr>{style}{br}</w:pPr><w:r><w:t xml:space="preserve">{escape(text)}</w:t></w:r></w:p>')

def table(headers, rows):
    width = 15000 // len(headers)
    xml = []
    for index, row in enumerate([headers, *rows]):
        shade = '<w:shd w:fill="DCE8F5"/>' if index == 0 else ''
        cells = ''.join(f'<w:tc><w:tcPr><w:tcW w:w="{width}" w:type="dxa"/>{shade}</w:tcPr><w:p><w:r><w:t>{escape(str(value))}</w:t></w:r></w:p></w:tc>' for value in row)
        xml.append(f'<w:tr>{cells}</w:tr>')
    borders = ''.join(f'<w:{edge} w:val="single" w:sz="4" w:color="B4C4D5"/>' for edge in ('top','bottom','left','right','insideH','insideV'))
    parts.append(f'<w:tbl><w:tblPr><w:tblBorders>{borders}</w:tblBorders></w:tblPr><w:tblGrid>' + ''.join(f'<w:gridCol w:w="{width}"/>' for _ in headers) + '</w:tblGrid>' + ''.join(xml) + '</w:tbl>')

cases = [
 ('01','Tạo đơn ONLINE','FR-M07-03','201, new/unfulfilled; id và mã'),
 ('02','Xác nhận, giữ 2/12','FR-M05-08; BR-02','confirmed; tồn 12/2/10'),
 ('03','Ship trước pack','FR-M07-02','409, không đổi đơn/tồn'),
 ('04','Pack hợp lệ','FR-M07-02','200, packing'),
 ('05','Pack lần hai','FR-M07-02','409, không đổi'),
 ('06','Ship với version cũ','FR-M07-02','409 version conflict'),
 ('07','Ship hợp lệ','FR-M07-02','200, shipping'),
 ('08','Hủy khi shipping','FR-M07-02; BR-02','409, giữ tồn'),
 ('09','Giao hàng','FR-M05-08; BR-02','delivered; tồn 10/0/10'),
 ('10','Thanh toán hoàn tất','FR-M07-02','201; completed/delivered'),
 ('11','Hủy sau hoàn tất','FR-M07-02; BR-02','409; tồn không đổi'),
 ('12','Xác nhận đơn thứ hai','FR-M05-08','giữ 3 trên 10'),
 ('13','Hủy, giải phóng','FR-M05-08; BR-02','cancelled; giữ 0'),
 ('14','Xác nhận đơn đã hủy','FR-M07-02','409, không đổi'),
 ('15','Đơn 11 khi còn 10','FR-M05-08; BR-02','409; đơn vẫn new; không giữ một phần'),
 ('16','Hai đơn tranh 10 tuần tự','FR-M05-08; BR-02','một 200, một 409; giải phóng'),
 ('17','Sales staff tạo/xác nhận','FR-M07-03','201 và 200'),
 ('18','Sales staff không thể hủy','FR-M07-02','403; đơn/tồn không đổi'),
 ('19','Accountant không thể tạo','FR-M07-03','403'),
 ('20','Không token không thể tạo','FR-M07-03','401'),
 ('21','Mã đơn duy nhất','BR-05','khác nhau; regex hiện hành'),
 ('22','Complete trước ship','FR-M07-02','kịch bản mong 409; cần thực nghiệm'),
 ('23','Online thiếu tồn lúc tạo','FR-M05-08; BR-02','kịch bản mong cờ thiếu tồn; cần thực nghiệm'),
 ('24','POS thiếu tồn','BR-02','409 INSUFFICIENT_STOCK'),
 ('25','Hai xác nhận gần đồng thời','FR-M05-08; BR-02','một 200, một 409; giữ đúng 10'),
 ('26','Mã đầu tiên ở tenant B','BR-05','tenant B đọc được đơn; sequence riêng; hai mã có thể giống nhau'),
]

p('BÁO CÁO KIỂM THỬ API',1)
p('Vòng đời đơn online, giữ tồn và mã đơn',2)
p('Dự án: Nền tảng SaaS quản trị bán lẻ đa kênh | Thành viên: Nguyên')
p('Ngày 11/11/2026 | Branch: test/nguyen-api-order-lifecycle-stock-reservation')
p('TRẠNG THÁI: Lượt mới trên bộ 26 ca: 24 Passed, 2 Failed, 0 Blocked. TC-22/23 là sai khác nghiệp vụ còn mở; chưa đạt exit criteria sản phẩm.')
p('Đối chiếu: Testing-Scenario-v2.docx; SRS-Nen-tang-SaaS-Quan-tri-Ban-le-Da-kenh_v1.1.docx; BaoCao-KiemThu-Luong5-ChuyenKho.docx.')
p('MỤC LỤC',1,True)
for entry in ('I. Record of Changes','II. Testing Documentation','1. Scope of Testing','2. Test Strategy & Approach','3. Test Plan','4. Static Testing - Cross-Review Log','5. Test Cases & Reports','5.1 Kết quả','5.2 Test case','5.3 Ma trận truy vết','5.4 Defect Report','5.5 Bằng chứng','5.6 Chạy lại'):
    p(entry)
p('I. Record of Changes',1,True)
table(['Phiên bản','Ngày','Người thực hiện','Thay đổi'],[['0.7','11/11/2026','Nguyên / hỗ trợ kỹ thuật','Bộ 26 ca đã chạy: 24 Passed, 2 Failed; TC-26 đa tenant Passed. DB xác nhận lại DEF-01/02; format cấu hình BR-05 vẫn thiếu API.']])
p('II. Testing Documentation',1)
p('1. Scope of Testing',2)
p('Phần 3 Testing Scenario v2: Nguyên phụ trách API Chức năng 5 (vòng đời đơn online) và Chức năng 6 (giữ tồn/mã đơn). Dùng Postman + Newman qua API Gateway. Yêu cầu FR-M07-02/03, FR-M05-08, BR-02/05. Ca phân quyền giới hạn ở đơn hàng. Không kiểm UI hoặc hiệu năng.')
p('SRS mô tả vòng đời tuyến tính. Mã nguồn lưu orderStatus, paymentStatus và fulfillmentStatus riêng; PACKING/SHIPPING là fulfillment stage. Ca 22/23 giữ kỳ vọng kịch bản để xác minh sai khác khi thực sự gọi API.')
p('2. Test Strategy & Approach',2)
table(['Kỹ thuật','Cách dùng','Ca'],[
 ['State transition','Đúng/sai thứ tự, hủy, version cũ, trả trạng thái','01-14, 22'],
 ['API integration','Gateway, đọc lại đơn và tồn, chờ read model hội tụ','02-03, 08-16, 18, 23-25'],
 ['Biên và tranh chấp','11 khi còn 10, tuần tự và hai request gần đồng thời','15-16, 25'],
 ['Security','Sales staff, accountant và không token','17-20'],
 ['Data integrity','Mã duy nhất/regex và sequence độc lập giữa hai tenant','21, 26']])
p('Tận dụng seed từ scripts/demo-events.sh và test tích hợp Jest sẵn có để đối chiếu, không sao chép. Mỗi lượt dùng tenant, chi nhánh, kho, SKU mới, nhập 12 đơn vị. Rủi ro cao: oversell, giải phóng sai giữ tồn, chuyển sai trạng thái, truy cập sai quyền.')
p('3. Test Plan',2)
table(['Mục','Kế hoạch / thực tế'],[
 ['Môi trường','Docker Compose (PostgreSQL, Redis, ElasticMQ, KrakenD và services), Gateway 8080, Node.js, Newman 6.2.1.'],
 ['Entry','Docker/Gateway và seed thành công từ PowerShell người dùng ở lượt 5; Newman thực thi toàn bộ collection.'],
 ['Exit','Bộ 26 ca đã chạy: 24 Passed, 2 Failed; TC-22/23 Failed và DB xác nhận. Format cấu hình BR-05 thiếu API; exit nghiệp vụ chưa đạt.'],
 ['Dữ liệu','Mỗi lượt có tenant A, 3 người dùng, chi nhánh/kho/SKU, nhập 12 đơn vị; tenant B và mã đơn đầu tiên cho TC-26.']])
p('4. Static Testing - Cross-Review Log',2)
table(['ID','Quan sát tĩnh','Xử lý'],[
 ['ST-01','SRS tuyến tính, code tách ba trục trạng thái.','Đọc đúng từng trường qua API.'],
 ['ST-02','Confirm khi confirmed và cancel khi cancelled có nhánh trả chi tiết.','Không tự gán 409 cho thao tác lặp.'],
 ['ST-03','Complete có thể tạo POS_PICKUP trước ship.','Ca 22 thực tế 200/delivered; lệch kịch bản đơn giao hàng.'],
 ['ST-04','Cờ shortage dường như ở internal tolerateShortage.','Ca 23 public gateway thực tế 409 INSUFFICIENT_STOCK.'],
 ['ST-05','Mã code có sáu chữ số; BR-05 đòi cấu hình được.','Ca 21/26 đạt về mã hai tenant; chưa phủ format cấu hình.']])
p('5. Test Cases & Reports',1,True)
p('5.1 Kết quả',2)
table(['Chỉ số','Giá trị','Bằng chứng'],[
 ['Thiết kế','26 ca, 70 collection items','TC-26 kiểm sequence của tenant B qua Gateway.'],
 ['Passed / Failed / Blocked','24 / 2 / 0','Lượt 2026-11-11T06-05-07-797Z: TC-22/23 Failed; TC-26 Passed.'],
 ['Newman','72 HTTP request; 127 assertion; 4 Failed','Báo cáo attempt-7.summary.json và attempt-7.newman.html; exit code 1 do hai ca Failed.'],
 ['Đối chiếu API/DB','Đã có','GET order/stock qua gateway; PostgreSQL lượt mới: TC-22 FULFILLED, stock 9/0/9; TC-23 lưu đơn x100 PENDING không cờ; 0 mã trùng.'],
 ['Push origin','Chưa có','GitHub không truy cập được từ phiên này.']])
p('5.2 Danh sách test case',2)
table(['ID','Kịch bản / dữ liệu','Yêu cầu','Kỳ vọng','Thực tế'],[[f'TC-NG-{id}',title,ref,expected,('FAILED: API trả 200/delivered, mong 409' if id == '22' else 'FAILED: API trả 409 INSUFFICIENT_STOCK, mong 201/cờ thiếu tồn' if id == '23' else 'PASSED qua Newman lượt mới')] for id,title,ref,expected in cases])
p('5.3 Ma trận truy vết',2)
table(['Yêu cầu','Ca','Bao phủ'],[
 ['FR-M07-02','03-11, 14, 18, 22','22 Failed; còn lại Passed lượt mới'],
 ['FR-M07-03','01, 17, 19, 20','Passed lượt mới'],
 ['FR-M05-08','02, 09, 12-13, 15-16, 23, 25','23 Failed; còn lại Passed lượt mới'],
 ['BR-02','02-03, 08-09, 11, 13, 15-16, 23-25','23 Failed; phần còn lại xem chi tiết ca'],
 ['BR-05','21, 26','Cả hai Passed; cấu hình format vẫn thiếu hợp đồng API']])
p('5.4 Defect Report',2)
table(['ID','Mô tả','Trạng thái'],[
 ['BLOCK-01','Docker permission denied trong phiên agent; Docker chạy từ PowerShell người dùng.','Môi trường agent / Open'],
 ['BLOCK-02','Seed POST /branches nhận 409 Q001 vì tenant Free đã có chi nhánh mặc định. Runner dùng GET /branches; lần 5 seed thành công.','Thiết lập test / Fixed, verified'],
 ['TEST-01','TC-01/15 mong pending nhưng response orderStatus là new; assertion đã sửa theo API.','Test data / Fixed, verified'],
 ['DEF-01','TC-22 đơn ONLINE complete trước ship trả 200/delivered; DB order FULFILLED, stock từ 10 xuống 9, reserved 0. Kịch bản yêu cầu 409 và tồn không đổi.','Nghiệp vụ / Open, cần triage'],
 ['DEF-02','TC-23 autoConfirm đơn ONLINE thiếu tồn trả 409 INSUFFICIENT_STOCK; DB vẫn lưu đơn x100 PENDING, exceptionCode null, không trả ID cho client. Kịch bản mong 201/cờ thiếu hàng.','Nghiệp vụ / Open, cần triage'],
 ['GAP-01','TC-26 đã thử hai tenant; chưa thử cấu hình format vì chưa có hợp đồng API.','Coverage / Partial'],
 ['GAP-02','Hai request gần đồng thời phụ thuộc lịch thực thi thực tế.','Giới hạn ca 25'],
 ['DEF-03 / BR-05','sales-code.generator.ts cố định HD-yyyyMMdd-######; không đọc thiết lập tenant. SRS yêu cầu format cấu hình được.','Sai khác tĩnh / cần thiết kế API']])
p('DEF-01 tái hiện: tạo đơn ONLINE một SKU x1 trên tenant thử, xác nhận, gọi POST /sales/api/v1/orders/{id}/complete với version hiện hành khi chưa pack/ship. Kỳ vọng theo Testing Scenario v2: 409 ORDER_INVALID_STATE, đơn/tồn không đổi. Ba lượt Newman nhận 200/delivered; PostgreSQL lượt mới xác nhận FULFILLED và stock 9/0/9 sau khi bắt đầu từ 10 và giữ 1. Xem attempt-7.summary.json và attempt-7.db.json.')
p('DEF-02 tái hiện: sau khi nhập 12 và hoàn tất đơn x2, tạo đơn ONLINE x100 với autoConfirm=true qua POST /sales/api/v1/orders/omnichannel. Kỳ vọng theo Testing Scenario v2: 201, đơn có cờ thiếu hàng. Ba lượt Newman nhận 409 INSUFFICIENT_STOCK. PostgreSQL lượt mới xác nhận đơn 63789b02-73f3-46bc-b3b7-afa5184b0e75, mã HD-20261111-000010, qty 100, PENDING/UNFULFILLED, exceptionCode null vẫn lưu; response không trả ID. Client retry có nguy cơ tạo thêm đơn. Xem attempt-7.db.json và DEFECTS-NGUYEN-API.md; cần thống nhất phạm vi public autoConfirm với chủ yêu cầu.')
p('5.5 Bằng chứng',2)
p('docs/testing/evidence/nguyen/: attempt-1..3 Docker permission denied; attempt-4 seed Q001; attempt-5/6 và attempt-7 gồm log, summary JSON và Newman HTML đã lọc. Lượt Compose 05-57-50 bị chặn trước Newman vì fetch failed lúc seed; sau đó runner chờ platform API readiness. Attempt-7: 24/26 Passed, 4 assertion Failed; attempt-7.db.json chỉ đọc theo tenant xác nhận stock 9/0/9, order TC-22 FULFILLED, order TC-23 x100 PENDING không cờ, 0 mã trùng. Raw Newman JSON nằm trong test/api/nguyen/reports/ vì chứa token; không commit.')
p('5.6 Chạy lại',2)
p('Bật Docker Desktop và xác nhận docker info. Tại pbl-api chạy npm --prefix test/api/nguyen run test:api. Xem reports/*.log, *.json, *.html, đối chiếu order/stock bằng API, chạy lại trên tenant mới. Ghi defect từ response; lọc token trước khi chia sẻ. Xem README và HANDOFF-NGUYEN-API-TESTING.md.')

document = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + ''.join(parts) + '<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr></w:body></w:document>'
styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="20"/></w:rPr></w:style>' + ''.join(f'<w:style w:type="paragraph" w:styleId="Heading{i}"><w:name w:val="heading {i}"/><w:rPr><w:b/><w:sz w:val="{34-4*i}"/></w:rPr></w:style>' for i in (1,2)) + '</w:styles>'
types = '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'
rels = '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
docrels = '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'
with ZipFile(out,'w',ZIP_DEFLATED) as archive:
    for name, content in (('[Content_Types].xml',types),('_rels/.rels',rels),('word/document.xml',document),('word/styles.xml',styles),('word/_rels/document.xml.rels',docrels)):
        archive.writestr(name,content)
print(out)
