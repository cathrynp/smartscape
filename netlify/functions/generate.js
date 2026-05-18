exports.handler = async function(event) {
  if(event.httpMethod==='OPTIONS'){
    return{statusCode:200,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'POST,OPTIONS'},body:''};
  }
  if(event.httpMethod!=='POST'){
    return{statusCode:405,body:'Method not allowed'};
  }
  try{
    const body=JSON.parse(event.body);
    const API_KEY=process.env.ANTHROPIC_API_KEY;
    const response=await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'x-api-key':API_KEY,
        'anthropic-version':'2023-06-01'
      },
      body:JSON.stringify(Object.assign({},body,{max_tokens:Math.min(body.max_tokens||800,800)}))
    });
    const data=await response.json();
    return{
      statusCode:200,
      headers:{'Access-Control-Allow-Origin':'*','Content-Type':'application/json'},
      body:JSON.stringify(data)
    };
  }catch(err){
    return{
      statusCode:500,
      headers:{'Access-Control-Allow-Origin':'*'},
      body:JSON.stringify({error:{message:err.message}})
    };
  }
};
