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
 ('01','Tạo đơn ONLINE','FR-M07-03','201, pending/unfulfilled; id và mã'),
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
 ('15','Đơn 11 khi còn 10','FR-M05-08; BR-02','409; không giữ một phần'),
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
]

p('BÁO CÁO KIỂM THỬ API',1)
p('Vòng đời đơn online, giữ tồn và mã đơn',2)
p('Dự án: Nền tảng SaaS quản trị bán lẻ đa kênh | Thành viên: Nguyên')
p('Ngày 11/11/2026 | Branch: test/nguyen-api-order-lifecycle-stock-reservation')
p('TRẠNG THÁI: BLOCKED. 0 ca được xác minh qua API; không ghi nhận Passed.')
p('Đối chiếu: Testing-Scenario-v2.docx; SRS-Nen-tang-SaaS-Quan-tri-Ban-le-Da-kenh_v1.1.docx; BaoCao-KiemThu-Luong5-ChuyenKho.docx.')
p('MỤC LỤC',1,True)
for entry in ('I. Record of Changes','II. Testing Documentation','1. Scope of Testing','2. Test Strategy & Approach','3. Test Plan','4. Static Testing - Cross-Review Log','5. Test Cases & Reports','5.1 Kết quả','5.2 Test case','5.3 Ma trận truy vết','5.4 Defect Report','5.5 Bằng chứng','5.6 Chạy lại'):
    p(entry)
p('I. Record of Changes',1,True)
table(['Phiên bản','Ngày','Người thực hiện','Thay đổi'],[['0.3','11/11/2026','Nguyên / hỗ trợ kỹ thuật','25 ca, 69 request; lần thứ tư Docker chạy, seed gặp Q001 do tạo chi nhánh thứ hai; runner đã sửa để dùng chi nhánh mặc định. Newman chưa chạy.']])
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
 ['Data integrity','Mã duy nhất/regex trong một tenant','21']])
p('Tận dụng seed từ scripts/demo-events.sh và test tích hợp Jest sẵn có để đối chiếu, không sao chép. Mỗi lượt dùng tenant, chi nhánh, kho, SKU mới, nhập 12 đơn vị. Rủi ro cao: oversell, giải phóng sai giữ tồn, chuyển sai trạng thái, truy cập sai quyền.')
p('3. Test Plan',2)
table(['Mục','Kế hoạch / thực tế'],[
 ['Môi trường','Docker Compose (PostgreSQL, Redis, ElasticMQ, KrakenD và services), Gateway 8080, Node.js, Newman 6.2.1.'],
 ['Entry','Docker/Gateway chạy từ PowerShell người dùng ở lượt 4; seed dừng tại quota chi nhánh Free. Runner đã sửa; cần chạy lại để xác minh.'],
 ['Exit','Newman chạy hai lần, có JSON/HTML, response/DB được đối chiếu, push branch. Chưa đạt.'],
 ['Dữ liệu','Đã tạo tenant/người dùng ở lượt 4; chưa tạo warehouse/SKU/tồn. Mỗi lần chạy tiếp theo dùng tenant riêng.']])
p('4. Static Testing - Cross-Review Log',2)
table(['ID','Quan sát tĩnh','Xử lý'],[
 ['ST-01','SRS tuyến tính, code tách ba trục trạng thái.','Đọc đúng từng trường qua API.'],
 ['ST-02','Confirm khi confirmed và cancel khi cancelled có nhánh trả chi tiết.','Không tự gán 409 cho thao tác lặp.'],
 ['ST-03','Complete có thể tạo POS_PICKUP trước ship.','Ca 22 cần response.'],
 ['ST-04','Cờ shortage dường như ở internal tolerateShortage.','Ca 23 cần response public.'],
 ['ST-05','Mã code có sáu chữ số; BR-05 đòi cấu hình được.','Ca 21 chưa phủ cấu hình/hai tenant.']])
p('5. Test Cases & Reports',1,True)
p('5.1 Kết quả',2)
table(['Chỉ số','Giá trị','Bằng chứng'],[
 ['Thiết kế','25 ca, 69 request','Postman collection và generator.'],
 ['Passed / Failed / Blocked','0 / 0 / 25','Lượt 4 dừng trong seed tại Q001; chưa chạy Newman.'],
 ['Newman JSON/HTML','Chưa có','Chỉ có blocked.json/html của runner; không phải Newman.'],
 ['Đối chiếu API/DB','Chưa có','Không xác nhận defect nghiệp vụ.'],
 ['Push origin','Chưa có','GitHub không truy cập được từ phiên này.']])
p('5.2 Danh sách test case',2)
table(['ID','Kịch bản / dữ liệu','Yêu cầu','Kỳ vọng','Thực tế'],[[f'TC-NG-{id}',title,ref,expected,'BLOCKED: chưa gọi API'] for id,title,ref,expected in cases])
p('5.3 Ma trận truy vết',2)
table(['Yêu cầu','Ca','Bao phủ'],[
 ['FR-M07-02','03-11, 14, 18, 22','Thiết kế; Blocked'],
 ['FR-M07-03','01, 17, 19, 20','Thiết kế; Blocked'],
 ['FR-M05-08','02, 09, 12-13, 15-16, 23, 25','Thiết kế; Blocked'],
 ['BR-02','02-03, 08-09, 11, 13, 15-16, 23-25','Thiết kế; Blocked'],
 ['BR-05','21','Một tenant/regex; chưa kiểm cấu hình và hai tenant']])
p('5.4 Defect Report',2)
table(['ID','Mô tả','Trạng thái'],[
 ['BLOCK-01','Docker permission denied trong phiên agent; Docker chạy từ PowerShell người dùng.','Môi trường agent / Open'],
 ['BLOCK-02','Seed POST /branches nhận 409 Q001 vì tenant Free đã có chi nhánh mặc định. Đã sửa runner dùng GET /branches; chờ chạy lại.','Thiết lập test / Fixed, unverified'],
 ['GAP-01','Chưa thử cấu hình mã và hai tenant.','Coverage / Open'],
 ['GAP-02','Hai request gần đồng thời phụ thuộc lịch thực thi thực tế.','Giới hạn ca 25'],
 ['Nghiệp vụ','Chưa có defect xác nhận bằng response; ST-03/04/05 chỉ là quan sát tĩnh.','Chưa xác minh']])
p('5.5 Bằng chứng',2)
p('docs/testing/evidence/nguyen/: attempt-1..3 ghi Docker permission denied; attempt-4 ghi POST /branches 409 Q001 từ API Gateway. Mỗi lượt có .log, .blocked.json và .blocked.html (newmanExecuted=false, passedCases=0). Không có report Newman hoặc đối chiếu DB. Raw Newman JSON tương lai có thể chứa token, không commit.')
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
