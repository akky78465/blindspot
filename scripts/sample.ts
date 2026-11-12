import ExcelJS from 'exceljs';
const groups:Record<string,string[]> = {
'Login':['Login with valid credentials','Logout after login','Reject incorrect password','Open dashboard after login'],
'Plan selection':['Display active plans','Select basic home plan','Select premium home plan','Show plan coverage','Show service fee'],
'Appliance selection':['Select refrigerator','Select washing machine','Select dishwasher','Select oven'],
'Issue description':['Describe cooling issue','Describe water leak','Describe noise issue','Edit issue description'],
'Appointment':['Choose tomorrow morning','Choose afternoon slot','Change selected slot','Show appointment confirmation'],
'Submission':['Review request summary','Submit valid service request','Show request reference','View submitted request']};
const details: Record<string,[string,string,string]> = {
'Login with valid credentials':['Enter demo@example.test and SyntheticPass123!; select Sign in','email: demo@example.test; password: SyntheticPass123!','Member dashboard opens and lists active plans'],
'Logout after login':['Sign in; open profile menu; select Sign out','action: sign_out','Session ends and sign-in page appears'],
'Reject incorrect password':['Enter the synthetic account email and a wrong password; select Sign in','email: demo@example.test; password: Incorrect123!','Generic invalid credentials message; no session created'],
'Open dashboard after login':['Sign in; open Dashboard','account: DEMO-MEMBER-001','Dashboard shows member plan and existing requests'],
'Display active plans':['Sign in; choose Create service request; inspect plan list','member: DEMO-MEMBER-001','Active Home Basic and Home Premium plans are listed'],
'Select basic home plan':['Open plan list; choose Home Basic; continue','plan: DEMO-BASIC-001','Home Basic is selected and appliance choices appear'],
'Select premium home plan':['Open plan list; choose Home Premium; continue','plan: DEMO-PREMIUM-001','Home Premium is selected and appliance choices appear'],
'Show plan coverage':['Choose Home Premium; open Coverage details','plan: DEMO-PREMIUM-001','Refrigerator, washer, dishwasher and oven coverage is displayed'],
'Show service fee':['Choose Home Premium; review fee information','plan: DEMO-PREMIUM-001; configuredFee: 75 USD','Configured service fee of 75 USD is displayed'],
'Select refrigerator':['Choose Home Premium; select Refrigerator; continue','appliance: Refrigerator','Refrigerator is retained on issue details screen'],
'Select washing machine':['Choose Home Premium; select Washing machine; continue','appliance: Washing machine','Washing machine is retained on issue details screen'],
'Select dishwasher':['Choose Home Premium; select Dishwasher; continue','appliance: Dishwasher','Dishwasher is retained on issue details screen'],
'Select oven':['Choose Home Premium; select Oven; continue','appliance: Oven','Oven is retained on issue details screen'],
'Describe cooling issue':['Choose Refrigerator; enter issue description; continue','description: Refrigerator is not cooling despite the power being on','Entered description appears unchanged in request summary'],
'Describe water leak':['Choose Washing machine; enter issue description; continue','description: Water leaks from the inlet hose during a wash cycle','Entered description is saved to the draft request'],
'Describe noise issue':['Choose Dishwasher; enter issue description; continue','description: A rattling noise occurs during the rinse cycle','Entered description is saved to the draft request'],
'Edit issue description':['Enter initial description; go back from appointments; edit description; continue','initial: Oven not heating; revised: Oven heats unevenly at 180 C','Only the revised description appears in the summary'],
'Choose tomorrow morning':['Open appointment picker; select tomorrow; choose available morning slot; continue','date: tomorrow relative to demo date; slot: 10:00-12:00','Selected morning appointment appears in summary'],
'Choose afternoon slot':['Open appointment picker; select an available future day; choose afternoon slot','date: available future day; slot: 14:00-16:00','Selected afternoon appointment appears in summary'],
'Change selected slot':['Choose morning slot; return to picker; choose available afternoon slot; continue','initial: 10:00-12:00; revised: 14:00-16:00','Summary reflects only the revised slot'],
'Show appointment confirmation':['Select available date and slot; open Review request','date: available future day; slot: 10:00-12:00','Date and slot are displayed in the member local time'],
'Review request summary':['Complete plan, appliance, issue and appointment steps; open summary','plan: Home Premium; appliance: Refrigerator; description: Not cooling','Summary matches the chosen plan, appliance, description and appointment'],
'Submit valid service request':['Complete all required fields; accept service fee; submit once','consent: true; fee: 75 USD','One service request is created and confirmation screen appears'],
'Show request reference':['Submit a valid service request; inspect confirmation','request: newly submitted synthetic request','Confirmation displays a nonempty request reference'],
'View submitted request':['Submit valid request; open My requests; open the new request','request: newly submitted synthetic request','Request details match submitted inputs and status is Submitted']
};
const book=new ExcelJS.Workbook();const sheet=book.addWorksheet('Service Requests');
sheet.columns=[{header:'ID',key:'id',width:12},{header:'Feature',key:'feature',width:24},{header:'Title',key:'title',width:35},{header:'Preconditions',key:'preconditions',width:40},{header:'Steps',key:'steps',width:65},{header:'Inputs',key:'inputs',width:55},{header:'Expected Result',key:'expected',width:60},{header:'Type',key:'type',width:16}];
let n=0;
for(const [feature,titles] of Object.entries(groups)) for(const title of titles){n++;sheet.addRow({id:`SRC-${n}`,feature,title,preconditions:feature==='Login'?'Synthetic member account exists':'Member is logged in with an active home warranty plan',steps:details[title][0],inputs:details[title][1],expected:details[title][2],type:title.startsWith('Reject')?'negative':'positive'});}
sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF173F35'}};sheet.views=[{state:'frozen',ySplit:1}];sheet.autoFilter='A1:H26';
book.xlsx.writeFile('samples/service-request-testcases.xlsx').catch(e=>{console.error(e);process.exitCode=1;});
console.log(`Created sample with ${n} test cases`);
