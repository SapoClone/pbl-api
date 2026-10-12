import { AccountEntity } from '@/api/account/entities/account.entity';
import { SYSTEM_USER_ID } from '@/constants/app.constant';
import { setSeederFactory } from 'typeorm-extension';

export default setSeederFactory(AccountEntity, (fake) => {
  const firstName = fake.person.firstName();
  const lastName = fake.person.lastName();
  return new AccountEntity({
    email: fake.internet.email({ firstName, lastName }),
    password: '12345678',
    name: `${firstName} ${lastName}`,
    createdBy: SYSTEM_USER_ID,
    updatedBy: SYSTEM_USER_ID,
  });
});
