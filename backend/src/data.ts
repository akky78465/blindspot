import { Faker, en } from '@faker-js/faker';
import { DataSpec } from './schemas';
export function generate(spec:DataSpec,seed:string):string|number|boolean|null {
  const faker=new Faker({locale:[en]});faker.seed([...seed].reduce((a,c)=>(a*31+c.charCodeAt(0))>>>0,0));
  const p=spec.params || {};const length=p.length ?? 256;
  switch(spec.kind){
    case 'literal': case 'duplicate': return p.value ?? 'SYNTHETIC-DUPLICATE-001';
    case 'number': return faker.number.int({min:p.min ?? 0,max:p.max ?? 100});
    case 'boundary': return (p.side==='max' ? p.max ?? 100 : p.min ?? 0)+(p.offset ?? 0);
    case 'invalid_length': return '9'.repeat(length);
    case 'long_string': return 'A'.repeat(length);
    case 'empty': return '';
    case 'null': return null;
    case 'whitespace': return '   \t';
    case 'unicode': return 'परीक्षण_日本語_é_🧪_\u200B';
    case 'special_chars': return '!@#$%^&*()<>"\'\\';
    case 'sql_injection': return "' OR '1'='1' --";
    case 'xss': return '<script>alert("synthetic-test")</script>';
    case 'invalid_email': return 'invalid@@example..test';
    case 'invalid_phone': return '12ABC!';
    case 'invalid_date': return '2030-02-30';
    case 'date': return p.value ?? '2028-02-29T00:00:00Z';
    case 'email': return `synthetic.${faker.string.alphanumeric(8)}@example.test`;
    case 'phone': return `+1-202-555-01${faker.string.numeric(2)}`;
    case 'name': return `Synthetic ${faker.person.firstName()}`;
  }
}
