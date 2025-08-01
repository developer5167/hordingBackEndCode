const client = require("../db");
const checkDomainAndReturnClientId = async  (request,response,next)=> {
    var domain = request.header("domain");
    if (!domain) {
    return response.status(401).json({ error: 'Invalid provider' });
  }
    const query = `select id from clients where $1 = ANY(client_domains)`;
    const result = await client.query(query,[domain]);
    if(result.rowCount>0){
    request.client_id = result.rows[0]['id'];
      next()
    }else{
      response.status(400).send({"message":"Invalid provider"})
    }
}
module.exports = checkDomainAndReturnClientId